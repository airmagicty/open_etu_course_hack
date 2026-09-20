// ==UserScript==
// @name         Open edX InVideoQuiz — Navigator PRO v4 (Multi-Select Support)
// @author       airmagicty
// @namespace    https://example.local/
// @version      4.0.0
// @description  Контролируемый перебор вариантов (radio + checkbox) с панелью управления
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
    };

    const config = window.InVideoQuizXBlock?.config;

    if (!config) {
        console.error('[QuizNavigator] InVideoQuizXBlock.config не найден');
        return;
    }

    const questions = [];
    let currentQuestionIndex = 0;

    /**
     * ---------------------------------------------------------
     * 2. Извлекаем вопросы и определяем их тип
     * ---------------------------------------------------------
     */

    for (const [videoId, markers] of Object.entries(config)) {
        for (const [time, problemId] of Object.entries(markers)) {
            const problem = document.querySelector(`[data-problem-id*="${problemId}"]`);
            if (!problem) {
                console.warn(`[QuizNavigator] Не найден problem ${problemId}`);
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
                    currentCombination: [],
                    results: [],
                    foundCorrect: false,
                    correctCombinations: [],
                    allCombinations: [], // Для checkbox
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
            // Генерируем комбинации, начиная с самых коротких (1 элемент, 2 элемента, ...)
            for (let k = 1; k <= n; k++) {
                const combo = [];
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
        }
    });

    console.log('[QuizNavigator] Найдено вопросов:', questions);

    /**
     * ---------------------------------------------------------
     * 3-6. Вспомогательные функции (без изменений)
     * ---------------------------------------------------------
     */

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
            if (!video) {
                reject(new Error('Видео не найдено'));
                return;
            }
            const targetTime = Math.max(0, time + CONFIG.seekOffset);
            if (video.readyState < 1) {
                const handler = () => {
                    video.removeEventListener('loadedmetadata', handler);
                    try {
                        video.currentTime = targetTime;
                        resolve(video);
                    } catch (error) {
                        reject(error);
                    }
                };
                video.addEventListener('loadedmetadata', handler);
                return;
            }
            try {
                video.currentTime = targetTime;
                resolve(video);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * ---------------------------------------------------------
     * 9. Выбор вариантов (обновлено для checkbox)
     * ---------------------------------------------------------
     */

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
        // Сначала снимаем все галочки
        inputs.forEach(input => {
            if (input.checked) {
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        // Затем ставим нужные
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
        const feedback = problem.querySelector('.submission-feedback, .notification');
        if (feedback) {
            const text = feedback.textContent.toLowerCase();
            if (text.includes('correct') || text.includes('верно') || text.includes('правильно')) return 'correct';
            if (text.includes('incorrect') || text.includes('неверно') || text.includes('неправильно')) return 'incorrect';
        }
        return 'unknown';
    }

    function clearHighlight(problem) {
        if (!problem) return;
        problem.classList.remove('quiz-navigator-highlight', 'quiz-navigator-correct', 'quiz-navigator-incorrect');
        problem.querySelectorAll('.quiz-navigator-label').forEach(el => el.remove());
    }

    function addResultLabel(problem, text, isCorrect) {
        const label = document.createElement('div');
        label.className = 'quiz-navigator-label';
        label.style.cssText = `
            margin-top: 8px;
            padding: 8px 12px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 14px;
            background: ${isCorrect ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'};
            border-left: 4px solid ${isCorrect ? '#22c55e' : '#ef4444'};
            color: ${isCorrect ? '#22c55e' : '#ef4444'};
        `;
        label.textContent = text;
        problem.appendChild(label);
    }

    /**
     * ---------------------------------------------------------
     * 14. Перебор вариантов (обновлено для checkbox)
     * ---------------------------------------------------------
     */

    async function bruteForceQuestion(question) {
        if (question.bruteState.isRunning) return;

        question.bruteState.isRunning = true;
        question.bruteState.results = [];
        question.bruteState.foundCorrect = false;
        question.bruteState.correctCombinations = [];

        const problem = getProblem(question);
        if (!problem) {
            question.bruteState.isRunning = false;
            return;
        }

        clearHighlight(problem);
        showProblem(problem);
        scrollToProblem(problem);
        updatePanel();

        if (question.questionType === 'radio') {
            // --- Логика для RADIO (одиночный выбор) ---
            const order = question.options.map((_, i) => i); // Простой порядок 0,1,2...
            // Можно добавить кастомный порядок, как в предыдущей версии, если нужно
            // const order = [1, 0, 2, 3, ...];

            for (let i = 0; i < order.length; i++) {
                const optionIndex = order[i];
                console.log(`[QuizNavigator] Проверка варианта ${optionIndex + 1}/${question.options.length}`);
                
                selectOption(problem, optionIndex);
                submitAnswer(problem);
                await new Promise(resolve => setTimeout(resolve, 800));

                const result = checkResult(problem);
                question.bruteState.results.push({ optionIndex, result });

                if (result === 'correct') {
                    question.bruteState.foundCorrect = true;
                    question.bruteState.correctCombinations.push([optionIndex]);
                    problem.classList.add('quiz-navigator-correct');
                    addResultLabel(problem, `✅ Правильный ответ: ${question.options[optionIndex].text}`, true);
                    break; // Для radio нашли один правильный - стоп
                } else if (result === 'incorrect') {
                    problem.classList.add('quiz-navigator-incorrect');
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } else if (question.questionType === 'checkbox') {
            // --- Логика для CHECKBOX (множественный выбор) ---
            const combinations = question.bruteState.allCombinations;
            console.log(`[QuizNavigator] Всего комбинаций для перебора: ${combinations.length}`);

            for (let i = 0; i < combinations.length; i++) {
                const combo = combinations[i];
                console.log(`[QuizNavigator] Проверка комбинации ${i + 1}/${combinations.length}: [${combo.join(', ')}]`);

                selectCombination(problem, combo);
                submitAnswer(problem);
                await new Promise(resolve => setTimeout(resolve, 800));

                const result = checkResult(problem);
                question.bruteState.results.push({ combination: combo, result });

                if (result === 'correct') {
                    question.bruteState.foundCorrect = true;
                    question.bruteState.correctCombinations.push(combo);
                    problem.classList.add('quiz-navigator-correct');
                    const texts = combo.map(idx => question.options[idx].text).join(', ');
                    addResultLabel(problem, `✅ Правильный ответ: ${texts}`, true);
                    // Не прерываемся, чтобы найти все возможные правильные комбинации
                } else if (result === 'incorrect') {
                    problem.classList.add('quiz-navigator-incorrect');
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        question.bruteState.isRunning = false;
        
        if (question.bruteState.correctCombinations.length === 0) {
            addResultLabel(problem, '❌ Правильные ответы не найдены', false);
        }

        console.log(`[QuizNavigator] Перебор завершен. Найдено правильных комбинаций: ${question.bruteState.correctCombinations.length}`);
        updatePanel();
    }

    /**
     * ---------------------------------------------------------
     * 15. Переход к вопросу
     * ---------------------------------------------------------
     */

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
                console.warn('[QuizNavigator] Ошибка перемотки:', error);
            }
        }
        problem.classList.add('quiz-navigator-highlight');
        setTimeout(() => problem.classList.remove('quiz-navigator-highlight'), 3000);
        updatePanel();
    }

    /**
     * ---------------------------------------------------------
     * 16. Создание панели
     * ---------------------------------------------------------
     */

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

    /**
     * ---------------------------------------------------------
     * 17. Обновление панели (обновлено)
     * ---------------------------------------------------------
     */

    function updatePanel() {
        const panel = document.getElementById(CONFIG.panelId);
        if (!panel) return;
        const content = panel.querySelector('#quiz-nav-content');
        if (!content) return;

        content.innerHTML = '';

        const infoBar = document.createElement('div');
        infoBar.style.cssText = `display: flex; gap: 8px; margin-bottom: 10px; padding: 6px 10px; background: #16213e; border-radius: 6px; font-size: 11px; color: #888; align-items: center;`;
        infoBar.innerHTML = `<span>🔄 Видео: <span style="color:#4ade80;">не останавливается</span></span><span style="margin-left:auto;">⚠️ Переход по кнопке "Перейти"</span>`;
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

        const showAllBtn = document.createElement('button');
        showAllBtn.textContent = '📋 Все вопросы';
        showAllBtn.style.cssText = `cursor: pointer; border: 0; padding: 6px 12px; border-radius: 5px; background: #374151; color: #eee;`;
        showAllBtn.addEventListener('click', () => {
            questions.forEach(q => {
                const p = getProblem(q);
                if (p) { p.hidden = false; p.style.removeProperty('display'); }
            });
        });
        nav.appendChild(showAllBtn);
        content.appendChild(nav);

        if (questions.length > 0) {
            const q = questions[currentQuestionIndex];
            const item = document.createElement('div');
            item.style.cssText = `border: 1px solid #2d2d44; border-radius: 8px; padding: 12px; margin-bottom: 10px; background: #16213e;`;

            const info = document.createElement('div');
            info.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;`;
            const timeLabel = document.createElement('span');
            timeLabel.textContent = `⏱ ${formatTime(q.time)} [${q.questionType.toUpperCase()}]`;
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

            const opts = document.createElement('div');
            opts.style.cssText = `margin-bottom: 8px; font-size: 12px; color: #ccc;`;
            q.options.forEach((opt, idx) => {
                const optDiv = document.createElement('div');
                optDiv.textContent = `${idx + 1}. ${opt.text}`;
                optDiv.style.cssText = `padding: 2px 0; color: #ccc;`;
                opts.appendChild(optDiv);
            });
            item.appendChild(opts);

            const status = document.createElement('div');
            status.style.cssText = `font-size: 11px; color: #888; margin-bottom: 6px;`;
            
            if (q.bruteState.isRunning) {
                status.textContent = '⏳ Перебор выполняется...';
                status.style.color = '#ffd93d';
            } else if (q.bruteState.foundCorrect) {
                status.textContent = `✅ Найдено правильных комбинаций: ${q.bruteState.correctCombinations.length}`;
                status.style.color = '#4ade80';
            } else if (q.bruteState.results.length > 0) {
                status.textContent = `❌ Перебор завершен. Правильных ответов не найдено`;
                status.style.color = '#f87171';
            } else {
                status.textContent = '⏳ Ожидает перебора';
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
            console.log('[QuizNavigator] ✅ Скрипт загружен. Найдено вопросов:', questions.length);
            console.log('[QuizNavigator] ℹ️ Для перехода к вопросу нажмите кнопку "Перейти"');
            const q = questions[0];
            const p = getProblem(q);
            if (p) showProblem(p);
            updatePanel();
        }
    }, 500);

    console.log('[QuizNavigator] ✅ Скрипт загружен. Режим: только сканирование, переход по кнопке');

})();