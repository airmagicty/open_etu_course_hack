// ==UserScript==
// @name         Open edX InVideoQuiz — Navigator PRO v3 (Control Panel)
// @author       airmagicty
// @namespace    https://example.local/
// @version      3.0.0
// @description  Контролируемый перебор вариантов с панелью управления
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        panelId: 'quiz-audit-panel-pro',
        videoSearchTimeout: 5000,
        pauseBeforeQuestion: true,
        seekOffset: 0,
        // Порядок перебора: сначала индекс 1 (второй вариант), потом остальные
        bruteOrder: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9]
    };

    /**
     * ---------------------------------------------------------
     * 1. Получаем конфигурацию InVideoQuiz
     * ---------------------------------------------------------
     */

    const config = window.InVideoQuizXBlock?.config;

    if (!config) {
        console.error('[QuizNavigator] InVideoQuizXBlock.config не найден');
        return;
    }

    const questions = [];
    let currentQuestionIndex = 0;
    let panelCollapsed = false;

    /**
     * ---------------------------------------------------------
     * 2. Извлекаем вопросы
     * ---------------------------------------------------------
     */

    for (const [videoId, markers] of Object.entries(config)) {

        for (const [time, problemId] of Object.entries(markers)) {

            const problem = document.querySelector(
                `[data-problem-id*="${problemId}"]`
            );

            if (!problem) {
                console.warn(
                    `[QuizNavigator] Не найден problem ${problemId}`
                );
                continue;
            }

            const legend = problem.querySelector('legend');

            const options = [
                ...problem.querySelectorAll(
                    'input[type="radio"]'
                )
            ].map(input => {

                const label = problem.querySelector(
                    `label[for="${CSS.escape(input.id)}"]`
                );

                return {
                    value: input.value,
                    text: label
                        ? label.textContent.trim()
                        : input.parentElement?.textContent.trim() || ''
                };

            });

            questions.push({
                videoId,
                time: Number(time),
                problemId,
                question: legend?.textContent.trim() || 'Без названия',
                options,
                element: problem,
                // Храним состояние перебора для каждого вопроса
                bruteState: {
                    isRunning: false,
                    currentIndex: 0,
                    results: [],
                    foundCorrect: false,
                    correctAnswers: [],
                    order: []
                }
            });
        }
    }

    questions.sort((a, b) => a.time - b.time);

    // Инициализируем порядок перебора для каждого вопроса
    questions.forEach(q => {
        const order = [];
        const maxOptions = q.options.length;
        
        // Сначала добавляем индекс 1 (второй вариант), если он существует
        if (maxOptions > 1) {
            order.push(1);
        }
        
        // Затем все остальные по порядку, кроме уже добавленного
        for (let i = 0; i < maxOptions; i++) {
            if (!order.includes(i)) {
                order.push(i);
            }
        }
        
        q.bruteState.order = order;
    });

    console.log(
        '[QuizNavigator] Найдено вопросов:',
        questions
    );

    /**
     * ---------------------------------------------------------
     * 3. Поиск video element
     * ---------------------------------------------------------
     */

    function getVideoElements() {
        return [...document.querySelectorAll('video')];
    }

    /**
     * ---------------------------------------------------------
     * 4. Получение video для конкретного вопроса
     * ---------------------------------------------------------
     */

    function getVideoForQuestion(question) {
        const videos = getVideoElements();

        if (!videos.length) {
            return null;
        }

        if (videos.length === 1) {
            return videos[0];
        }

        const block = document.querySelector(
            `[data-videoid="${question.videoId}"]`
        );

        if (block) {
            const parent = block.closest('.xblock-student_view-invideoquiz');
            if (parent) {
                const video = parent.querySelector('video');
                if (video) {
                    return video;
                }
            }
        }

        return videos[0];
    }

    /**
     * ---------------------------------------------------------
     * 5. Поиск элемента вопроса
     * ---------------------------------------------------------
     */

    function getProblem(question) {
        return document.querySelector(
            `[data-problem-id*="${question.problemId}"]`
        );
    }

    /**
     * ---------------------------------------------------------
     * 6. Прокрутка к вопросу
     * ---------------------------------------------------------
     */

    function scrollToProblem(problem) {
        if (!problem) return;
        problem.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    /**
     * ---------------------------------------------------------
     * 7. Показать вопрос
     * ---------------------------------------------------------
     */

    function showProblem(problem) {
        if (!problem) return;

        problem.hidden = false;
        problem.style.removeProperty('display');
        problem.style.removeProperty('visibility');

        let parent = problem.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
            if (parent.hidden) {
                parent.hidden = false;
            }
            parent = parent.parentElement;
        }

        problem.classList.add('quiz-navigator-active');
    }

    /**
     * ---------------------------------------------------------
     * 8. Перемотка видео
     * ---------------------------------------------------------
     */

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
     * 9. Выбор варианта ответа
     * ---------------------------------------------------------
     */

    function selectOption(problem, optionIndex) {
        const inputs = problem.querySelectorAll('input[type="radio"]');
        if (inputs[optionIndex]) {
            inputs[optionIndex].checked = true;
            // Триггерим события для XBlock
            inputs[optionIndex].dispatchEvent(new Event('change', { bubbles: true }));
            inputs[optionIndex].dispatchEvent(new Event('click', { bubbles: true }));
            return true;
        }
        return false;
    }

    /**
     * ---------------------------------------------------------
     * 10. Проверка ответа (через штатную кнопку Submit)
     * ---------------------------------------------------------
     */

    function submitAnswer(problem) {
        const submitBtn = problem.querySelector('.submit-attempt-container .submit');
        if (submitBtn) {
            submitBtn.click();
            return true;
        }
        return false;
    }

    /**
     * ---------------------------------------------------------
     * 11. Проверка результата (правильно/неправильно)
     * ---------------------------------------------------------
     */

    function checkResult(problem) {
        // Проверяем наличие классов правильности
        const correct = problem.querySelector('.status.correct, .correct, .is-correct');
        const incorrect = problem.querySelector('.status.incorrect, .incorrect, .is-incorrect');
        
        if (correct) return 'correct';
        if (incorrect) return 'incorrect';
        
        // Проверяем текст
        const feedback = problem.querySelector('.submission-feedback, .notification');
        if (feedback) {
            const text = feedback.textContent.toLowerCase();
            if (text.includes('correct') || text.includes('верно') || text.includes('правильно')) {
                return 'correct';
            }
            if (text.includes('incorrect') || text.includes('неверно') || text.includes('неправильно')) {
                return 'incorrect';
            }
        }
        
        return 'unknown';
    }

    /**
     * ---------------------------------------------------------
     * 12. Очистка подсветки
     * ---------------------------------------------------------
     */

    function clearHighlight(problem) {
        if (!problem) return;
        problem.classList.remove('quiz-navigator-highlight');
        problem.classList.remove('quiz-navigator-correct');
        problem.classList.remove('quiz-navigator-incorrect');
        
        // Удаляем метки
        const labels = problem.querySelectorAll('.quiz-navigator-label');
        labels.forEach(el => el.remove());
    }

    /**
     * ---------------------------------------------------------
     * 13. Добавление метки результата
     * ---------------------------------------------------------
     */

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
     * 14. Перебор вариантов для вопроса
     * ---------------------------------------------------------
     */

    async function bruteForceQuestion(question) {
        if (question.bruteState.isRunning) {
            console.log('[QuizNavigator] Перебор уже выполняется');
            return;
        }

        question.bruteState.isRunning = true;
        question.bruteState.results = [];
        question.bruteState.foundCorrect = false;
        question.bruteState.correctAnswers = [];

        const problem = getProblem(question);
        if (!problem) {
            console.error('[QuizNavigator] Problem не найден');
            question.bruteState.isRunning = false;
            return;
        }

        // Очищаем старые метки
        clearHighlight(problem);

        // Показываем вопрос
        showProblem(problem);
        scrollToProblem(problem);

        const order = question.bruteState.order;
        const totalOptions = question.options.length;

        console.log(`[QuizNavigator] Начинаем перебор для вопроса: ${question.question}`);
        console.log(`[QuizNavigator] Порядок перебора: ${order.join(', ')}`);

        // Обновляем панель
        updatePanel();

        for (let i = 0; i < order.length; i++) {
            const optionIndex = order[i];
            
            if (optionIndex >= totalOptions) continue;

            console.log(`[QuizNavigator] Проверка варианта ${optionIndex + 1}/${totalOptions}: "${question.options[optionIndex].text}"`);

            // Выбираем вариант
            selectOption(problem, optionIndex);

            // Отправляем на проверку
            submitAnswer(problem);

            // Ждем ответа от сервера
            await new Promise(resolve => setTimeout(resolve, 800));

            // Проверяем результат
            const result = checkResult(problem);
            
            question.bruteState.results.push({
                optionIndex: optionIndex,
                optionText: question.options[optionIndex].text,
                result: result
            });

            if (result === 'correct') {
                question.bruteState.foundCorrect = true;
                question.bruteState.correctAnswers.push(optionIndex);
                
                // Подсвечиваем правильный ответ
                problem.classList.add('quiz-navigator-correct');
                addResultLabel(problem, `✅ Правильный ответ: ${question.options[optionIndex].text}`, true);
                
                console.log(`[QuizNavigator] ✅ Найден правильный ответ: вариант ${optionIndex + 1}`);
                
                // Обновляем панель
                updatePanel();
                
                // Спрашиваем, продолжать ли перебор
                const continueBrute = confirm(
                    `Найден правильный ответ!\n\n` +
                    `Вариант ${optionIndex + 1}: "${question.options[optionIndex].text}"\n\n` +
                    `Продолжить перебор остальных вариантов?`
                );
                
                if (!continueBrute) {
                    break;
                }
                
                // Очищаем метку для следующей проверки
                clearHighlight(problem);
                
            } else if (result === 'incorrect') {
                problem.classList.add('quiz-navigator-incorrect');
                console.log(`[QuizNavigator] ❌ Неправильный ответ: вариант ${optionIndex + 1}`);
            } else {
                console.log(`[QuizNavigator] ⏳ Результат не определен для варианта ${optionIndex + 1}`);
            }

            // Небольшая задержка между попытками
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        question.bruteState.isRunning = false;
        
        // Финальное обновление
        if (question.bruteState.correctAnswers.length === 0) {
            addResultLabel(problem, '❌ Правильные ответы не найдены', false);
        } else if (question.bruteState.correctAnswers.length > 1) {
            const answers = question.bruteState.correctAnswers.map(idx => 
                `${idx + 1}: ${question.options[idx].text}`
            ).join('\n');
            addResultLabel(problem, `✅ Найдено несколько правильных ответов:\n${answers}`, true);
        }

        console.log(`[QuizNavigator] Перебор завершен. Найдено правильных ответов: ${question.bruteState.correctAnswers.length}`);
        updatePanel();
    }

    /**
     * ---------------------------------------------------------
     * 15. Переход к вопросу
     * ---------------------------------------------------------
     */

    async function goToQuestion(index) {
        if (index < 0 || index >= questions.length) return;
        
        currentQuestionIndex = index;
        const question = questions[index];
        
        console.log(`[QuizNavigator] Переход к вопросу ${index + 1}/${questions.length}: ${question.question}`);
        
        const problem = getProblem(question);
        if (!problem) {
            alert(`Вопрос ${index + 1} не найден в DOM`);
            return;
        }

        const video = getVideoForQuestion(question);
        
        if (video) {
            try {
                await seekVideo(video, question.time);
                if (CONFIG.pauseBeforeQuestion) {
                    video.pause();
                }
            } catch (error) {
                console.warn('[QuizNavigator] Ошибка перемотки:', error);
            }
        }

        showProblem(problem);
        scrollToProblem(problem);
        
        // Подсветка
        problem.classList.add('quiz-navigator-highlight');
        setTimeout(() => {
            problem.classList.remove('quiz-navigator-highlight');
        }, 3000);

        updatePanel();
    }

    /**
     * ---------------------------------------------------------
     * 16. Создание панели
     * ---------------------------------------------------------
     */

    function createPanel() {
        const oldPanel = document.getElementById(CONFIG.panelId);
        if (oldPanel) {
            oldPanel.remove();
        }

        const panel = document.createElement('div');
        panel.id = CONFIG.panelId;

        Object.assign(panel.style, {
            position: 'fixed',
            bottom: '20px',
            left: '20px',
            width: '500px',
            maxHeight: '75vh',
            overflowY: 'auto',
            zIndex: '999999',
            background: '#1a1a2e',
            color: '#eee',
            padding: '16px',
            border: '2px solid #2d2d44',
            borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0,0,0,.6)',
            fontFamily: 'Arial, sans-serif',
            fontSize: '13px',
            transition: 'all 0.3s ease'
        });

        /**
         * Заголовок с управлением
         */
        const header = document.createElement('div');
        header.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
                <div>
                    <strong style="font-size:16px;color:#ffd93d;">🎯 InVideoQuiz Navigator PRO</strong>
                    <span style="margin-left:10px;font-size:12px;color:#888;">вопросов: ${questions.length}</span>
                </div>
                <div style="display:flex;gap:6px;">
                    <button id="quiz-nav-collapse" style="
                        cursor:pointer;
                        border:0;
                        background:#2d2d44;
                        color:#eee;
                        border-radius:5px;
                        padding:4px 10px;
                        font-size:14px;
                    ">−</button>
                    <button id="quiz-nav-close" style="
                        cursor:pointer;
                        border:0;
                        background:#2d2d44;
                        color:#eee;
                        border-radius:5px;
                        padding:4px 10px;
                        font-size:14px;
                    ">×</button>
                </div>
            </div>
        `;
        panel.appendChild(header);

        /**
         * Контейнер для содержимого
         */
        const content = document.createElement('div');
        content.id = 'quiz-nav-content';
        panel.appendChild(content);

        /**
         * Управление свертыванием
         */
        let isCollapsed = false;
        header.querySelector('#quiz-nav-collapse').addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            header.querySelector('#quiz-nav-collapse').textContent = isCollapsed ? '+' : '−';
        });

        /**
         * Закрытие (скрываем панель, но не удаляем)
         */
        header.querySelector('#quiz-nav-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        document.body.appendChild(panel);

        // Обновляем содержимое
        updatePanel();
    }

    /**
     * ---------------------------------------------------------
     * 17. Обновление панели
     * ---------------------------------------------------------
     */

    function updatePanel() {
        const panel = document.getElementById(CONFIG.panelId);
        if (!panel) return;

        const content = panel.querySelector('#quiz-nav-content');
        if (!content) return;

        content.innerHTML = '';

        /**
         * Навигационные кнопки
         */
        const nav = document.createElement('div');
        nav.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        `;

        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Предыдущий';
        prevBtn.style.cssText = `
            cursor: pointer;
            border: 0;
            padding: 6px 12px;
            border-radius: 5px;
            background: #2d2d44;
            color: #eee;
            font-weight: bold;
        `;
        prevBtn.addEventListener('click', () => {
            if (currentQuestionIndex > 0) {
                goToQuestion(currentQuestionIndex - 1);
            }
        });
        nav.appendChild(prevBtn);

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Следующий ▶';
        nextBtn.style.cssText = `
            cursor: pointer;
            border: 0;
            padding: 6px 12px;
            border-radius: 5px;
            background: #2d2d44;
            color: #eee;
            font-weight: bold;
        `;
        nextBtn.addEventListener('click', () => {
            if (currentQuestionIndex < questions.length - 1) {
                goToQuestion(currentQuestionIndex + 1);
            }
        });
        nav.appendChild(nextBtn);

        const showAllBtn = document.createElement('button');
        showAllBtn.textContent = '📋 Все вопросы';
        showAllBtn.style.cssText = `
            cursor: pointer;
            border: 0;
            padding: 6px 12px;
            border-radius: 5px;
            background: #374151;
            color: #eee;
        `;
        showAllBtn.addEventListener('click', () => {
            questions.forEach(q => {
                const p = getProblem(q);
                if (p) {
                    p.hidden = false;
                    p.style.removeProperty('display');
                }
            });
            alert('Все вопросы показаны');
        });
        nav.appendChild(showAllBtn);

        content.appendChild(nav);

        /**
         * Текущий вопрос
         */
        if (questions.length > 0) {
            const q = questions[currentQuestionIndex];
            const item = document.createElement('div');
            item.style.cssText = `
                border: 1px solid #2d2d44;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 10px;
                background: #16213e;
            `;

            // Информация о вопросе
            const info = document.createElement('div');
            info.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            `;

            const timeLabel = document.createElement('span');
            timeLabel.textContent = `⏱ ${formatTime(q.time)}`;
            timeLabel.style.cssText = `color: #ffd93d; font-weight: bold;`;
            info.appendChild(timeLabel);

            const indexLabel = document.createElement('span');
            indexLabel.textContent = `${currentQuestionIndex + 1}/${questions.length}`;
            indexLabel.style.cssText = `color: #888; font-size: 12px;`;
            info.appendChild(indexLabel);

            item.appendChild(info);

            // Текст вопроса
            const title = document.createElement('div');
            title.textContent = q.question;
            title.style.cssText = `
                font-weight: bold;
                color: #fff;
                margin-bottom: 8px;
                font-size: 14px;
            `;
            item.appendChild(title);

            // Варианты ответов
            const opts = document.createElement('div');
            opts.style.cssText = `
                margin-bottom: 8px;
                font-size: 12px;
                color: #ccc;
            `;
            q.options.forEach((opt, idx) => {
                const optDiv = document.createElement('div');
                optDiv.textContent = `${idx + 1}. ${opt.text}`;
                optDiv.style.cssText = `
                    padding: 2px 0;
                    color: ${q.bruteState.correctAnswers.includes(idx) ? '#4ade80' : '#ccc'};
                `;
                if (q.bruteState.correctAnswers.includes(idx)) {
                    optDiv.textContent = `✅ ${idx + 1}. ${opt.text}`;
                }
                opts.appendChild(optDiv);
            });
            item.appendChild(opts);

            // Статус перебора
            const status = document.createElement('div');
            status.style.cssText = `
                font-size: 11px;
                color: #888;
                margin-bottom: 6px;
            `;
            
            if (q.bruteState.isRunning) {
                status.textContent = '⏳ Перебор выполняется...';
                status.style.color = '#ffd93d';
            } else if (q.bruteState.correctAnswers.length > 0) {
                status.textContent = `✅ Найдено правильных ответов: ${q.bruteState.correctAnswers.length}`;
                status.style.color = '#4ade80';
            } else if (q.bruteState.results.length > 0) {
                status.textContent = `❌ Перебор завершен. Правильных ответов не найдено`;
                status.style.color = '#f87171';
            } else {
                status.textContent = '⏳ Ожидает перебора';
            }
            item.appendChild(status);

            // Кнопки действий
            const actions = document.createElement('div');
            actions.style.cssText = `
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
            `;

            const bruteBtn = document.createElement('button');
            bruteBtn.textContent = q.bruteState.isRunning ? '⏳ Перебор...' : '🔍 Перебор вариантов';
            bruteBtn.style.cssText = `
                cursor: ${q.bruteState.isRunning ? 'default' : 'pointer'};
                border: 0;
                padding: 6px 12px;
                border-radius: 5px;
                background: ${q.bruteState.isRunning ? '#374151' : '#dc2626'};
                color: #fff;
                font-weight: bold;
                opacity: ${q.bruteState.isRunning ? '0.6' : '1'};
            `;
            bruteBtn.disabled = q.bruteState.isRunning;
            bruteBtn.addEventListener('click', () => {
                if (!q.bruteState.isRunning) {
                    bruteForceQuestion(q);
                }
            });
            actions.appendChild(bruteBtn);

            const goBtn = document.createElement('button');
            goBtn.textContent = '▶ Перейти';
            goBtn.style.cssText = `
                cursor: pointer;
                border: 0;
                padding: 6px 12px;
                border-radius: 5px;
                background: #2563eb;
                color: #fff;
            `;
            goBtn.addEventListener('click', () => {
                goToQuestion(currentQuestionIndex);
            });
            actions.appendChild(goBtn);

            // Кнопка для показа варианта
            const showOptionsBtn = document.createElement('button');
            showOptionsBtn.textContent = '👁 Показать варианты';
            showOptionsBtn.style.cssText = `
                cursor: pointer;
                border: 0;
                padding: 6px 12px;
                border-radius: 5px;
                background: #374151;
                color: #eee;
            `;
            showOptionsBtn.addEventListener('click', () => {
                const p = getProblem(q);
                if (p) {
                    const inputs = p.querySelectorAll('input[type="radio"]');
                    inputs.forEach((input, idx) => {
                        const label = p.querySelector(`label[for="${CSS.escape(input.id)}"]`);
                        if (label) {
                            label.style.cssText = `
                                display: block;
                                padding: 4px 8px;
                                margin: 2px 0;
                                background: ${q.bruteState.correctAnswers.includes(idx) ? 'rgba(34, 197, 94, 0.2)' : 'transparent'};
                                border-left: ${q.bruteState.correctAnswers.includes(idx) ? '3px solid #22c55e' : '3px solid transparent'};
                            `;
                        }
                    });
                }
            });
            actions.appendChild(showOptionsBtn);

            item.appendChild(actions);

            content.appendChild(item);
        }

        /**
         * Список всех вопросов (краткий)
         */
        const allList = document.createElement('div');
        allList.style.cssText = `
            margin-top: 10px;
            border-top: 1px solid #2d2d44;
            padding-top: 10px;
            max-height: 200px;
            overflow-y: auto;
        `;

        const allTitle = document.createElement('div');
        allTitle.textContent = '📋 Все вопросы:';
        allTitle.style.cssText = `
            font-size: 12px;
            color: #888;
            margin-bottom: 6px;
        `;
        allList.appendChild(allTitle);

        questions.forEach((q, idx) => {
            const item = document.createElement('div');
            item.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 6px;
                cursor: pointer;
                border-radius: 4px;
                font-size: 12px;
                color: ${idx === currentQuestionIndex ? '#ffd93d' : '#aaa'};
                background: ${idx === currentQuestionIndex ? 'rgba(255, 217, 61, 0.1)' : 'transparent'};
            `;
            item.addEventListener('click', () => {
                goToQuestion(idx);
            });

            const timeSpan = document.createElement('span');
            timeSpan.textContent = formatTime(q.time);
            timeSpan.style.cssText = `color: #666; font-family: monospace;`;
            item.appendChild(timeSpan);

            const titleSpan = document.createElement('span');
            const shortTitle = q.question.length > 30 ? q.question.slice(0, 30) + '...' : q.question;
            titleSpan.textContent = shortTitle;
            titleSpan.style.cssText = `flex: 1; margin: 0 8px;`;

            // Индикатор статуса
            const statusDot = document.createElement('span');
            if (q.bruteState.correctAnswers.length > 0) {
                statusDot.textContent = '✅';
            } else if (q.bruteState.results.length > 0) {
                statusDot.textContent = '❌';
            } else {
                statusDot.textContent = '⏳';
            }
            statusDot.style.cssText = `font-size: 10px;`;

            item.appendChild(titleSpan);
            item.appendChild(statusDot);

            allList.appendChild(item);
        });

        content.appendChild(allList);
    }

    /**
     * ---------------------------------------------------------
     * 18. Формат времени
     * ---------------------------------------------------------
     */

    function formatTime(seconds) {
        seconds = Math.floor(seconds);
        const minutes = Math.floor(seconds / 60);
        const sec = seconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    /**
     * ---------------------------------------------------------
     * 19. CSS стили
     * ---------------------------------------------------------
     */

    const style = document.createElement('style');
    style.textContent = `
        .quiz-navigator-active {
            outline: 3px solid rgba(255, 217, 61, .6) !important;
            transition: outline 0.3s ease;
        }

        .quiz-navigator-highlight {
            animation: quizNavigatorPulse .7s ease-in-out 4;
        }

        .quiz-navigator-correct {
            outline: 3px solid #22c55e !important;
            box-shadow: 0 0 20px rgba(34, 197, 94, .3);
        }

        .quiz-navigator-incorrect {
            outline: 3px solid #ef4444 !important;
            box-shadow: 0 0 20px rgba(239, 68, 68, .2);
        }

        @keyframes quizNavigatorPulse {
            0% { box-shadow: 0 0 0 rgba(255, 217, 61, 0); }
            50% { box-shadow: 0 0 30px rgba(255, 217, 61, .6); }
            100% { box-shadow: 0 0 0 rgba(255, 217, 61, 0); }
        }

        #quiz-nav-content::-webkit-scrollbar {
            width: 4px;
        }
        #quiz-nav-content::-webkit-scrollbar-track {
            background: #1a1a2e;
        }
        #quiz-nav-content::-webkit-scrollbar-thumb {
            background: #2d2d44;
            border-radius: 2px;
        }
    `;
    document.head.appendChild(style);

    /**
     * ---------------------------------------------------------
     * 20. Запуск
     * ---------------------------------------------------------
     */

    // Показываем первый вопрос при загрузке
    setTimeout(() => {
        createPanel();
        if (questions.length > 0) {
            goToQuestion(0);
        }
    }, 500);

    console.log('[QuizNavigator] ✅ Скрипт загружен');

})();