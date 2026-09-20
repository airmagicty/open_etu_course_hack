// ==UserScript==
// @name         Open edX InVideoQuiz — Navigator PRO v4.1 (Multi-Select + Debug)
// @author       airmagicty
// @namespace    https://example.local/
// @version      4.1.0
// @description  Контролируемый перебор вариантов (radio + checkbox) с панелью управления и отладкой
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        panelId: 'quiz-audit-panel-pro',
        videoSearchTimeout: 5000,
        pauseBeforeQuestion: false,
        seekOffset: 0,
        stopOnFirstCorrect: true, // Останавливать перебор после первой правильной комбинации
        debug: true,              // Подробное логирование в консоль
    };

    // ---------------------------------------------------------
    // Логгер с префиксом
    // ---------------------------------------------------------
    const log = {
        info: (...args) => console.log('%c[QuizNavigator]', 'color:#ffd93d;font-weight:bold', ...args),
        success: (...args) => console.log('%c[QuizNavigator] ✅ SUCCESS', 'color:#4ade80;font-weight:bold', ...args),
        fail: (...args) => console.log('%c[QuizNavigator] ❌ FAIL', 'color:#f87171;font-weight:bold', ...args),
        warn: (...args) => console.warn('%c[QuizNavigator] ⚠️', 'color:#fbbf24;font-weight:bold', ...args),
        debug: (...args) => { if (CONFIG.debug) console.log('%c[QuizNavigator] 🐛', 'color:#60a5fa', ...args); },
    };

    const config = window.InVideoQuizXBlock?.config;

    if (!config) {
        console.error('[QuizNavigator] InVideoQuizXBlock.config не найден');
        return;
    }

    const questions = [];
    let currentQuestionIndex = 0;

    // ---------------------------------------------------------
    // Извлекаем вопросы и определяем их тип
    // ---------------------------------------------------------

    for (const [videoId, markers] of Object.entries(config)) {
        for (const [time, problemId] of Object.entries(markers)) {
            const problem = document.querySelector(`[data-problem-id*="${problemId}"]`);
            if (!problem) {
                log.warn(`Не найден problem ${problemId}`);
                continue;
            }

            const legend = problem.querySelector('legend');
            const radioInputs = problem.querySelectorAll('input[type="radio"]');
            const checkboxInputs = problem.querySelectorAll('input[type="checkbox"]');

            let questionType = 'unknown';
            let inputs = [];

            if (radioInputs.length > 0) {
                questionType = 'radio';
                inputs = [...radioInputs];
            } else if (checkboxInputs.length > 0) {
                questionType = 'checkbox';
                inputs = [...checkboxInputs];
            }

            const options = inputs.map(input => {
                const label = problem.querySelector(`label[for="${CSS.escape(input.id)}"]`);
                return {
                    value: input.value,
                    text: label ? label.textContent.trim() : input.parentElement?.textContent.trim() || '',
                };
            });

            questions.push({
                videoId,
                time: Number(time),
                problemId,
                question: legend?.textContent.trim() || 'Без названия',
                options,
                element: problem,
                questionType: questionType,
                bruteState: {
                    isRunning: false,
                    results: [],
                    foundCorrect: false,
                    correctCombinations: [],
                    allCombinations: [],
                }
            });
        }
    }

    questions.sort((a, b) => a.time - b.time);

    // Генерируем комбинации для checkbox-вопросов
    questions.forEach(q => {
        if (q.questionType === 'checkbox') {
            const n = q.options.length;
            const combinations = [];
            for (let k = 1; k <= n; k++) {
                const generate = (start, current) => {
                    if (current.length === k) {
                        combinations.push([...current]);
                        return;
                    }
                    for (let i = start; i < n; i++) {
                        current.push(i);
                        generate(i + 1, current);
                        current.pop();
                    }
                };
                generate(0, []);
            }
            q.bruteState.allCombinations = combinations;
            log.debug(`Вопрос "${q.question}" (checkbox): сгенерировано ${combinations.length} комбинаций`);
        }
    });

    log.info('Найдено вопросов:', questions.length);
    questions.forEach((q, i) => log.debug(`  ${i + 1}. [${q.questionType}] ${q.question} (${q.options.length} опций)`));

    // ---------------------------------------------------------
    // Вспомогательные функции
    // ---------------------------------------------------------

    function getVideoElements() {
        return [...document.querySelectorAll('video')];
    }

    function getVideoForQuestion(question) {
        const videos = getVideoElements();
        if (!videos.length) return null;
        if (videos.length === 1) return videos[0];
        const block = document.querySelector(`[data-videoid="${question.videoId}"]`);
        if (block) {
            const parent = block.closest('.xblock-student_view-invideoquiz');
            if (parent) {
                const video = parent.querySelector('video');
                if (video) return video;
            }
        }
        return videos[0];
    }

    function getProblem(question) {
        return document.querySelector(`[data-problem-id*="${question.problemId}"]`);
    }

    function scrollToProblem(problem) {
        if (!problem) return;
        problem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function showProblem(problem) {
        if (!problem) return;
        problem.hidden = false;
        problem.style.removeProperty('display');
        problem.style.removeProperty('visibility');
        let parent = problem.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
            if (parent.hidden) parent.hidden = false;
            parent = parent.parentElement;
        }
        problem.classList.add('quiz-navigator-active');
    }

    function seekVideo(video, time) {
        return new Promise((resolve, reject) => {
            if (!video) { reject(new Error('Видео не найдено')); return; }
            const targetTime = Math.max(0, time + CONFIG.seekOffset);
            if (video.readyState < 1) {
                const handler = () => {
                    video.removeEventListener('loadedmetadata', handler);
                    try { video.currentTime = targetTime; resolve(video); }
                    catch (error) { reject(error); }
                };
                video.addEventListener('loadedmetadata', handler);
                return;
            }
            try { video.currentTime = targetTime; resolve(video); }
            catch (error) { reject(error); }
        });
    }

    // ---------------------------------------------------------
    // Выбор вариантов
    // ---------------------------------------------------------

    function selectOption(problem, optionIndex) {
        const inputs = problem.querySelectorAll('input[type="radio"]');
        if (inputs[optionIndex]) {
            inputs[optionIndex].checked = true;
            inputs[optionIndex].dispatchEvent(new Event('change', { bubbles: true }));
            inputs[optionIndex].dispatchEvent(new Event('click', { bubbles: true }));
            return true;
        }
        return false;
    }

    function selectCombination(problem, indices) {
        const inputs = problem.querySelectorAll('input[type="checkbox"]');
        inputs.forEach(input => {
            if (input.checked) {
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        indices.forEach(index => {
            if (inputs[index]) {
                inputs[index].checked = true;
                inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
                inputs[index].dispatchEvent(new Event('click', { bubbles: true }));
            }
        });
        return true;
    }

    function submitAnswer(problem) {
        const submitBtn = problem.querySelector('.submit-attempt-container .submit');
        if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
            return true;
        }
        return false;
    }

    function checkResult(problem) {
        const correct = problem.querySelector('.status.correct, .correct, .is-correct');
        const incorrect = problem.querySelector('.status.incorrect, .incorrect, .is-incorrect');
        if (correct) return 'correct';
        if (incorrect) return 'incorrect';
        return 'unknown';
    }

    function clearHighlight(problem) {
        if (!problem) return;
        problem.classList.remove('quiz-navigator-highlight', 'quiz-navigator-correct', 'quiz-navigator-incorrect');
        problem.querySelectorAll('.quiz-navigator-label').forEach(el => el.remove());
        // Также снимаем подсветку с лейблов опций
        problem.querySelectorAll('label').forEach(lbl => {
            lbl.style.removeProperty('background');
            lbl.style.removeProperty('border-left');
            lbl.style.removeProperty('padding-left');
        });
    }

    function addResultLabel(problem, html, isCorrect) {
        const label = document.createElement('div');
        label.className = 'quiz-navigator-label';
        label.style.cssText = `
            margin-top: 12px;
            padding: 10px 14px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            background: ${isCorrect ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'};
            border-left: 4px solid ${isCorrect ? '#22c55e' : '#ef4444'};
            color: ${isCorrect ? '#4ade80' : '#f87171'};
            white-space: pre-line;
        `;
        label.innerHTML = html;
        problem.appendChild(label);
    }

    /**
     * Подсветить правильные варианты в самом вопросе
     */
    function highlightCorrectOptions(problem, question, indices) {
        const selector = question.questionType === 'radio' ? 'input[type="radio"]' : 'input[type="checkbox"]';
        const inputs = problem.querySelectorAll(selector);
        indices.forEach(idx => {
            const input = inputs[idx];
            if (!input) return;
            const label = problem.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) {
                label.style.background = 'rgba(34, 197, 94, 0.25)';
                label.style.borderLeft = '4px solid #22c55e';
                label.style.paddingLeft = '8px';
                label.style.borderRadius = '4px';
            }
        });
    }

    // ---------------------------------------------------------
    // Перебор вариантов
    // ---------------------------------------------------------

    async function bruteForceQuestion(question) {
        if (question.bruteState.isRunning) {
            log.warn('Перебор уже выполняется для этого вопроса');
            return;
        }

        question.bruteState.isRunning = true;
        question.bruteState.results = [];
        question.bruteState.foundCorrect = false;
        question.bruteState.correctCombinations = [];

        const problem = getProblem(question);
        if (!problem) {
            log.fail('Problem не найден в DOM');
            question.bruteState.isRunning = false;
            return;
        }

        clearHighlight(problem);
        showProblem(problem);
        scrollToProblem(problem);
        updatePanel();

        log.info(`━━━ Начинаем перебор ━━━`);
        log.info(`Вопрос: "${question.question}"`);
        log.info(`Тип: ${question.questionType}, опций: ${question.options.length}`);

        if (question.questionType === 'radio') {
            // --- RADIO ---
            const total = question.options.length;
            for (let i = 0; i < total; i++) {
                log.info(`Проверка варианта ${i + 1}/${total}: "${question.options[i].text}"`);

                selectOption(problem, i);
                submitAnswer(problem);
                await new Promise(r => setTimeout(r, 900));

                const result = checkResult(problem);
                question.bruteState.results.push({ optionIndex: i, result });

                if (result === 'correct') {
                    log.success(`Вариант ${i + 1} — ПРАВИЛЬНЫЙ!`);
                    question.bruteState.foundCorrect = true;
                    question.bruteState.correctCombinations.push([i]);
                    problem.classList.add('quiz-navigator-correct');
                    highlightCorrectOptions(problem, question, [i]);
                    addResultLabel(
                        problem,
                        `✅ ПРАВИЛЬНЫЙ ОТВЕТ: вариант ${i + 1}\n${question.options[i].text}`,
                        true
                    );
                    if (CONFIG.stopOnFirstCorrect) {
                        log.info('Останавливаем перебор (найден правильный ответ)');
                        break;
                    }
                } else if (result === 'incorrect') {
                    log.fail(`Вариант ${i + 1} — неправильный`);
                } else {
                    log.warn(`Вариант ${i + 1} — результат не определён`);
                }

                await new Promise(r => setTimeout(r, 400));
            }

        } else if (question.questionType === 'checkbox') {
            // --- CHECKBOX ---
            const combinations = question.bruteState.allCombinations;
            log.info(`Всего комбинаций: ${combinations.length}`);

            for (let i = 0; i < combinations.length; i++) {
                const combo = combinations[i];
                const comboText = combo.map(idx => `"${question.options[idx].text}"`).join(' + ');
                log.info(`Проверка комбинации ${i + 1}/${combinations.length}: [${combo.join(',')}] → ${comboText}`);

                selectCombination(problem, combo);
                submitAnswer(problem);
                await new Promise(r => setTimeout(r, 900));

                const result = checkResult(problem);
                question.bruteState.results.push({ combination: combo, result });

                if (result === 'correct') {
                    log.success(`Комбинация [${combo.join(',')}] — ПРАВИЛЬНАЯ! ${comboText}`);
                    question.bruteState.foundCorrect = true;
                    question.bruteState.correctCombinations.push(combo);
                    // Не подсвечиваем сразу, чтобы не сбрасывать при следующей отправке
                    if (CONFIG.stopOnFirstCorrect) {
                        log.info('Останавливаем перебор (найдена правильная комбинация)');
                        break;
                    }
                } else if (result === 'incorrect') {
                    log.fail(`Комбинация [${combo.join(',')}] — неправильная`);
                } else {
                    log.warn(`Комбинация [${combo.join(',')}] — результат не определён`);
                }

                await new Promise(r => setTimeout(r, 400));
            }
        }

        // ─── Финальная подсветка результата ───
        clearHighlight(problem);

        if (question.bruteState.correctCombinations.length > 0) {
            // Восстанавливаем правильную комбинацию в UI
            const bestCombo = question.bruteState.correctCombinations[0];
            if (question.questionType === 'radio') {
                selectOption(problem, bestCombo[0]);
            } else {
                selectCombination(problem, bestCombo);
            }
            submitAnswer(problem);
            await new Promise(r => setTimeout(r, 900));

            problem.classList.add('quiz-navigator-correct');
            highlightCorrectOptions(problem, question, bestCombo);

            const answersText = bestCombo
                .map(idx => `• вариант ${idx + 1}: ${question.options[idx].text}`)
                .join('\n');
            addResultLabel(
                problem,
                `✅ НАЙДЕН ПРАВИЛЬНЫЙ ОТВЕТ:\n${answersText}\n\nВсего правильных комбинаций: ${question.bruteState.correctCombinations.length}`,
                true
            );
            log.success(`━━━ ИТОГ: найдено ${question.bruteState.correctCombinations.length} правильных комбинаций ━━━`);
        } else {
            problem.classList.add('quiz-navigator-incorrect');
            addResultLabel(problem, '❌ Правильные ответы НЕ найдены', false);
            log.fail(`━━━ ИТОГ: правильные ответы не найдены (проверено ${question.bruteState.results.length} вариантов) ━━━`);
        }

        question.bruteState.isRunning = false;
        updatePanel();
    }

    // ---------------------------------------------------------
    // Переход к вопросу
    // ---------------------------------------------------------

    async function goToQuestion(index, autoScroll = true) {
        if (index < 0 || index >= questions.length) return;
        currentQuestionIndex = index;
        const question = questions[index];
        const problem = getProblem(question);
        if (!problem) {
            alert(`Вопрос ${index + 1} не найден в DOM`);
            return;
        }
        showProblem(problem);
        if (autoScroll) scrollToProblem(problem);

        const video = getVideoForQuestion(question);
        if (video) {
            try {
                const wasPlaying = !video.paused;
                await seekVideo(video, question.time);
                if (wasPlaying && video.paused) {
                    await video.play().catch(() => {});
                }
            } catch (error) {
                log.warn('Ошибка перемотки:', error);
            }
        }
        problem.classList.add('quiz-navigator-highlight');
        setTimeout(() => problem.classList.remove('quiz-navigator-highlight'), 3000);
        updatePanel();
    }

    // ---------------------------------------------------------
    // Создание панели
    // ---------------------------------------------------------

    function createPanel() {
        const oldPanel = document.getElementById(CONFIG.panelId);
        if (oldPanel) oldPanel.remove();

        const panel = document.createElement('div');
        panel.id = CONFIG.panelId;
        Object.assign(panel.style, {
            position: 'fixed', bottom: '20px', left: '20px', width: '500px',
            maxHeight: '75vh', overflowY: 'auto', zIndex: '999999',
            background: '#1a1a2e', color: '#eee', padding: '16px',
            border: '2px solid #2d2d44', borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0,0,0,.6)', fontFamily: 'Arial, sans-serif',
            fontSize: '13px', transition: 'all 0.3s ease'
        });

        const header = document.createElement('div');
        header.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
                <div>
                    <strong style="font-size:16px;color:#ffd93d;">🎯 InVideoQuiz Navigator PRO</strong>
                    <span style="margin-left:10px;font-size:12px;color:#888;">вопросов: ${questions.length}</span>
                </div>
                <div style="display:flex;gap:6px;">
                    <button id="quiz-nav-collapse" style="cursor:pointer;border:0;background:#2d2d44;color:#eee;border-radius:5px;padding:4px 10px;font-size:14px;">−</button>
                    <button id="quiz-nav-close" style="cursor:pointer;border:0;background:#2d2d44;color:#eee;border-radius:5px;padding:4px 10px;font-size:14px;">×</button>
                </div>
            </div>
        `;
        panel.appendChild(header);

        const content = document.createElement('div');
        content.id = 'quiz-nav-content';
        panel.appendChild(content);

        let isCollapsed = false;
        header.querySelector('#quiz-nav-collapse').addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            header.querySelector('#quiz-nav-collapse').textContent = isCollapsed ? '+' : '−';
        });
        header.querySelector('#quiz-nav-close').addEventListener('click', () => panel.style.display = 'none');

        document.body.appendChild(panel);
        updatePanel();
    }

    // ---------------------------------------------------------
    // Обновление панели
    // ---------------------------------------------------------

    function updatePanel() {
        const panel = document.getElementById(CONFIG.panelId);
        if (!panel) return;
        const content = panel.querySelector('#quiz-nav-content');
        if (!content) return;

        content.innerHTML = '';

        const infoBar = document.createElement('div');
        infoBar.style.cssText = `display: flex; gap: 8px; margin-bottom: 10px; padding: 6px 10px; background: #16213e; border-radius: 6px; font-size: 11px; color: #888; align-items: center;`;
        infoBar.innerHTML = `<span>🔄 Видео не останавливается</span><span style="margin-left:auto;">Стоп после 1-го успеха: <b style="color:#4ade80;">${CONFIG.stopOnFirstCorrect ? 'ДА' : 'НЕТ'}</b></span>`;
        content.appendChild(infoBar);

        const nav = document.createElement('div');
        nav.style.cssText = `display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;`;

        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Предыдущий';
        prevBtn.style.cssText = `cursor: pointer; border: 0; padding: 6px 12px; border-radius: 5px; background: #2d2d44; color: #eee; font-weight: bold;`;
        prevBtn.addEventListener('click', () => { if (currentQuestionIndex > 0) goToQuestion(currentQuestionIndex - 1, true); });
        nav.appendChild(prevBtn);

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Следующий ▶';
        nextBtn.style.cssText = `cursor: pointer; border: 0; padding: 6px 12px; border-radius: 5px; background: #2d2d44; color: #eee; font-weight: bold;`;
        nextBtn.addEventListener('click', () => { if (currentQuestionIndex < questions.length - 1) goToQuestion(currentQuestionIndex + 1, true); });
        nav.appendChild(nextBtn);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '🧹 Сброс';
        clearBtn.style.cssText = `cursor: pointer; border: 0; padding: 6px 12px; border-radius: 5px; background: #374151; color: #eee;`;
        clearBtn.addEventListener('click', () => {
            const q = questions[currentQuestionIndex];
            const p = getProblem(q);
            if (p) clearHighlight(p);
            q.bruteState.results = [];
            q.bruteState.correctCombinations = [];
            q.bruteState.foundCorrect = false;
            updatePanel();
        });
        nav.appendChild(clearBtn);

        content.appendChild(nav);

        if (questions.length > 0) {
            const q = questions[currentQuestionIndex];
            const item = document.createElement('div');
            item.style.cssText = `border: 1px solid #2d2d44; border-radius: 8px; padding: 12px; margin-bottom: 10px; background: #16213e;`;

            const info = document.createElement('div');
            info.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;`;
            const timeLabel = document.createElement('span');
            const typeColor = q.questionType === 'checkbox' ? '#a78bfa' : '#60a5fa';
            timeLabel.innerHTML = `⏱ ${formatTime(q.time)} <span style="color:${typeColor};font-size:11px;">[${q.questionType.toUpperCase()}]</span>`;
            timeLabel.style.cssText = `color: #ffd93d; font-weight: bold;`;
            info.appendChild(timeLabel);
            const indexLabel = document.createElement('span');
            indexLabel.textContent = `${currentQuestionIndex + 1}/${questions.length}`;
            indexLabel.style.cssText = `color: #888; font-size: 12px;`;
            info.appendChild(indexLabel);
            item.appendChild(info);

            const title = document.createElement('div');
            title.textContent = q.question;
            title.style.cssText = `font-weight: bold; color: #fff; margin-bottom: 8px; font-size: 14px;`;
            item.appendChild(title);

            // Список опций с отметкой правильных
            const opts = document.createElement('div');
            opts.style.cssText = `margin-bottom: 8px; font-size: 12px; color: #ccc;`;
            const correctIndices = q.bruteState.correctCombinations.length > 0
                ? q.bruteState.correctCombinations[0]
                : [];
            q.options.forEach((opt, idx) => {
                const optDiv = document.createElement('div');
                const isCorrect = correctIndices.includes(idx);
                optDiv.textContent = `${isCorrect ? '✅' : '⬜'} ${idx + 1}. ${opt.text}`;
                optDiv.style.cssText = `padding: 3px 6px; color: ${isCorrect ? '#4ade80' : '#ccc'}; ${isCorrect ? 'background: rgba(34,197,94,0.1); border-radius:3px;' : ''}`;
                opts.appendChild(optDiv);
            });
            item.appendChild(opts);

            const status = document.createElement('div');
            status.style.cssText = `font-size: 12px; margin-bottom: 8px; padding: 6px 8px; border-radius: 4px;`;
            if (q.bruteState.isRunning) {
                status.textContent = `⏳ Перебор выполняется... (${q.bruteState.results.length} проверено)`;
                status.style.background = 'rgba(255, 217, 61, 0.15)';
                status.style.color = '#ffd93d';
            } else if (q.bruteState.foundCorrect) {
                status.textContent = `✅ УСПЕХ: найдено ${q.bruteState.correctCombinations.length} правильных комбинаций (проверено ${q.bruteState.results.length})`;
                status.style.background = 'rgba(34, 197, 94, 0.15)';
                status.style.color = '#4ade80';
            } else if (q.bruteState.results.length > 0) {
                status.textContent = `❌ НЕУДАЧА: правильных ответов не найдено (проверено ${q.bruteState.results.length})`;
                status.style.background = 'rgba(239, 68, 68, 0.15)';
                status.style.color = '#f87171';
            } else {
                status.textContent = '⏳ Ожидает перебора';
                status.style.color = '#888';
            }
            item.appendChild(status);

            const actions = document.createElement('div');
            actions.style.cssText = `display: flex; gap: 6px; flex-wrap: wrap;`;

            const bruteBtn = document.createElement('button');
            bruteBtn.textContent = q.bruteState.isRunning ? '⏳ Перебор...' : '🔍 Перебор вариантов';
            bruteBtn.style.cssText = `cursor: ${q.bruteState.isRunning ? 'default' : 'pointer'}; border: 0; padding: 6px 12px; border-radius: 5px; background: ${q.bruteState.isRunning ? '#374151' : '#dc2626'}; color: #fff; font-weight: bold; opacity: ${q.bruteState.isRunning ? '0.6' : '1'};`;
            bruteBtn.disabled = q.bruteState.isRunning;
            bruteBtn.addEventListener('click', () => { if (!q.bruteState.isRunning) bruteForceQuestion(q); });
            actions.appendChild(bruteBtn);

            const goBtn = document.createElement('button');
            goBtn.textContent = '▶ Перейти';
            goBtn.style.cssText = `cursor: pointer; border: 0; padding: 6px 12px; border-radius: 5px; background: #2563eb; color: #fff; font-weight: bold;`;
            goBtn.addEventListener('click', () => goToQuestion(currentQuestionIndex, true));
            actions.appendChild(goBtn);

            const showBtn = document.createElement('button');
            showBtn.textContent = '👁 Показать';
            showBtn.style.cssText = `cursor: pointer; border: 0; padding: 6px 12px; border-radius: 5px; background: #374151; color: #eee;`;
            showBtn.addEventListener('click', () => { const p = getProblem(q); if (p) { showProblem(p); scrollToProblem(p); } });
            actions.appendChild(showBtn);

            item.appendChild(actions);
            content.appendChild(item);
        }

        const allList = document.createElement('div');
        allList.style.cssText = `margin-top: 10px; border-top: 1px solid #2d2d44; padding-top: 10px; max-height: 200px; overflow-y: auto;`;
        const allTitle = document.createElement('div');
        allTitle.textContent = '📋 Все вопросы:';
        allTitle.style.cssText = `font-size: 12px; color: #888; margin-bottom: 6px;`;
        allList.appendChild(allTitle);

        questions.forEach((q, idx) => {
            const item = document.createElement('div');
            item.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; color: ${idx === currentQuestionIndex ? '#ffd93d' : '#aaa'}; background: ${idx === currentQuestionIndex ? 'rgba(255, 217, 61, 0.1)' : 'transparent'};`;
            item.addEventListener('click', () => goToQuestion(idx, true));

            const timeSpan = document.createElement('span');
            timeSpan.textContent = formatTime(q.time);
            timeSpan.style.cssText = `color: #666; font-family: monospace;`;
            item.appendChild(timeSpan);

            const titleSpan = document.createElement('span');
            const shortTitle = q.question.length > 30 ? q.question.slice(0, 30) + '...' : q.question;
            titleSpan.textContent = shortTitle;
            titleSpan.style.cssText = `flex: 1; margin: 0 8px;`;
            item.appendChild(titleSpan);

            const statusDot = document.createElement('span');
            if (q.bruteState.foundCorrect) statusDot.textContent = '✅';
            else if (q.bruteState.results.length > 0) statusDot.textContent = '❌';
            else statusDot.textContent = '⏳';
            statusDot.style.cssText = `font-size: 10px;`;
            item.appendChild(statusDot);

            allList.appendChild(item);
        });
        content.appendChild(allList);
    }

    function formatTime(seconds) {
        seconds = Math.floor(seconds);
        const minutes = Math.floor(seconds / 60);
        const sec = seconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    const style = document.createElement('style');
    style.textContent = `
        .quiz-navigator-active { outline: 3px solid rgba(255, 217, 61, .6) !important; transition: outline 0.3s ease; }
        .quiz-navigator-highlight { animation: quizNavigatorPulse .7s ease-in-out 4; }
        .quiz-navigator-correct { outline: 3px solid #22c55e !important; box-shadow: 0 0 20px rgba(34, 197, 94, .3); }
        .quiz-navigator-incorrect { outline: 3px solid #ef4444 !important; box-shadow: 0 0 20px rgba(239, 68, 68, .2); }
        @keyframes quizNavigatorPulse { 0% { box-shadow: 0 0 0 rgba(255, 217, 61, 0); } 50% { box-shadow: 0 0 30px rgba(255, 217, 61, .6); } 100% { box-shadow: 0 0 0 rgba(255, 217, 61, 0); } }
        #quiz-nav-content::-webkit-scrollbar { width: 4px; }
        #quiz-nav-content::-webkit-scrollbar-track { background: #1a1a2e; }
        #quiz-nav-content::-webkit-scrollbar-thumb { background: #2d2d44; border-radius: 2px; }
    `;
    document.head.appendChild(style);

    setTimeout(() => {
        createPanel();
        if (questions.length > 0) {
            log.success(`Скрипт загружен. Найдено вопросов: ${questions.length}`);
            const q = questions[0];
            const p = getProblem(q);
            if (p) showProblem(p);
            updatePanel();
        }
    }, 500);

})();