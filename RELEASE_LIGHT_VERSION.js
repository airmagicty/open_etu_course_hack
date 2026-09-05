// ==UserScript==
// @name         Open edX InVideoQuiz — Question Navigator
// @namespace    https://example.local/
// @version      1.0.0
// @description  Поиск вопросов InVideoQuiz и переход/запуск вопросов по времени видео
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        panelId: 'quiz-audit-panel',
        videoSearchTimeout: 5000,
        pauseBeforeQuestion: true,
        seekOffset: 0
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
                question:
                    legend?.textContent.trim() || 'Без названия',
                options,
                element: problem
            });
        }
    }

    questions.sort((a, b) => a.time - b.time);

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

        return [
            ...document.querySelectorAll('video')
        ];

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

        /*
         * Если на странице одно видео —
         * используем его.
         */

        if (videos.length === 1) {
            return videos[0];
        }

        /*
         * Если видео несколько,
         * пытаемся найти video внутри XBlock.
         */

        const block = document.querySelector(
            `[data-videoid="${question.videoId}"]`
        );

        if (block) {

            const parent = block.closest(
                '.xblock-student_view-invideoquiz'
            );

            if (parent) {

                const video = parent.querySelector('video');

                if (video) {
                    return video;
                }
            }
        }

        /*
         * Fallback
         */

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

        if (!problem) {
            return;
        }

        problem.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });

    }


    /**
     * ---------------------------------------------------------
     * 7. Попытка сделать вопрос видимым
     * ---------------------------------------------------------
     */

    function showProblem(problem) {

        if (!problem) {
            return;
        }

        /*
         * Снимаем наиболее распространённые способы
         * скрытия элемента.
         */

        problem.hidden = false;

        problem.style.removeProperty('display');
        problem.style.removeProperty('visibility');

        /*
         * Родительские контейнеры InVideoQuiz иногда
         * могут быть скрыты.
         */

        let parent = problem.parentElement;

        for (let i = 0; i < 5 && parent; i++) {

            if (parent.hidden) {
                parent.hidden = false;
            }

            parent = parent.parentElement;
        }

        problem.classList.add(
            'quiz-navigator-active'
        );

    }


    /**
     * ---------------------------------------------------------
     * 8. Перемотка видео
     * ---------------------------------------------------------
     */

    function seekVideo(video, time) {

        return new Promise((resolve, reject) => {

            if (!video) {
                reject(
                    new Error('Видео не найдено')
                );

                return;
            }

            const targetTime =
                Math.max(
                    0,
                    time + CONFIG.seekOffset
                );

            /*
             * Если metadata ещё не загружены,
             * ждём loadedmetadata.
             */

            if (video.readyState < 1) {

                const handler = () => {

                    video.removeEventListener(
                        'loadedmetadata',
                        handler
                    );

                    try {
                        video.currentTime = targetTime;
                        resolve(video);
                    } catch (error) {
                        reject(error);
                    }

                };

                video.addEventListener(
                    'loadedmetadata',
                    handler
                );

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
     * 9. Главная функция запуска вопроса
     * ---------------------------------------------------------
     */

    async function launchQuestion(question) {

        console.log(
            '[QuizNavigator] Запуск вопроса:',
            question
        );

        const problem = getProblem(question);

        if (!problem) {

            alert(
                `Не найден вопрос ${question.problemId}`
            );

            return;

        }

        const video =
            getVideoForQuestion(question);

        if (!video) {

            /*
             * Даже если video API недоступен,
             * показываем сам вопрос.
             */

            showProblem(problem);
            scrollToProblem(problem);

            return;
        }

        try {

            /*
             * 1. Перематываем видео
             */

            await seekVideo(
                video,
                question.time
            );

            /*
             * 2. Останавливаем видео.
             *
             * Это важно:
             * вопрос должен появиться в нужный момент.
             */

            if (CONFIG.pauseBeforeQuestion) {

                video.pause();

            }

            /*
             * 3. Показываем вопрос
             */

            showProblem(problem);

            /*
             * 4. Прокручиваем страницу
             */

            scrollToProblem(problem);

            /*
             * 5. Подсвечиваем
             */

            problem.classList.add(
                'quiz-navigator-highlight'
            );

            setTimeout(() => {

                problem.classList.remove(
                    'quiz-navigator-highlight'
                );

            }, 3000);

            console.log(
                `[QuizNavigator] Видео установлено на ${question.time} сек.`
            );

        } catch (error) {

            console.error(
                '[QuizNavigator] Ошибка запуска:',
                error
            );

            showProblem(problem);
            scrollToProblem(problem);

        }

    }


    /**
     * ---------------------------------------------------------
     * 10. Создание панели
     * ---------------------------------------------------------
     */

    function createPanel() {

        const oldPanel =
            document.getElementById(
                CONFIG.panelId
            );

        if (oldPanel) {
            oldPanel.remove();
        }

        const panel =
            document.createElement('div');

        panel.id = CONFIG.panelId;

        Object.assign(panel.style, {

            position: 'fixed',

            top: '20px',
            right: '20px',

            width: '460px',
            maxHeight: '80vh',

            overflowY: 'auto',

            zIndex: '999999',

            background: '#ffffff',
            color: '#111111',

            padding: '20px',

            border: '2px solid #333',

            borderRadius: '10px',

            boxShadow:
                '0 10px 40px rgba(0,0,0,.35)',

            fontFamily:
                'Arial, sans-serif'

        });


        /**
         * Заголовок
         */

        const header =
            document.createElement('div');

        header.innerHTML = `
            <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:10px;
            ">
                <strong style="font-size:18px">
                    InVideoQuiz
                </strong>

                <button
                    id="quiz-navigator-close"
                    style="
                        cursor:pointer;
                        border:0;
                        background:#eee;
                        border-radius:5px;
                        padding:4px 8px;
                    "
                >
                    ×
                </button>
            </div>

            <div style="
                margin-top:8px;
                color:#666;
                font-size:13px;
            ">
                Найдено вопросов: ${questions.length}
            </div>
        `;

        panel.appendChild(header);


        /**
         * Закрытие
         */

        header
            .querySelector(
                '#quiz-navigator-close'
            )
            .addEventListener(
                'click',
                () => panel.remove()
            );


        /**
         * -----------------------------------------------------
         * Список вопросов
         * -----------------------------------------------------
         */

        questions.forEach(
            (question, index) => {

                const item =
                    document.createElement('div');

                Object.assign(item.style, {

                    marginTop: '15px',

                    padding: '12px',

                    border:
                        '1px solid #ddd',

                    borderRadius: '7px',

                    background:
                        '#fafafa'

                });


                /**
                 * Время
                 */

                const time =
                    document.createElement('div');

                time.textContent =
                    `${formatTime(question.time)}`;

                Object.assign(time.style, {

                    fontWeight: 'bold',

                    color: '#555',

                    marginBottom: '5px'

                });

                item.appendChild(time);


                /**
                 * Текст вопроса
                 */

                const title =
                    document.createElement('div');

                title.textContent =
                    question.question;

                Object.assign(title.style, {

                    fontWeight: 'bold',

                    marginBottom: '10px'

                });

                item.appendChild(title);


                /**
                 * Кнопка запуска
                 */

                const launchButton =
                    document.createElement('button');

                launchButton.textContent =
                    '▶ Запустить вопрос';

                Object.assign(
                    launchButton.style,
                    {

                        cursor: 'pointer',

                        border: '0',

                        padding:
                            '8px 12px',

                        borderRadius:
                            '5px',

                        background:
                            '#222',

                        color:
                            '#fff',

                        fontWeight:
                            'bold'

                    }
                );


                launchButton.addEventListener(
                    'click',
                    () => {

                        launchButton.disabled = true;

                        launchButton.textContent =
                            '⏳ Запуск...';

                        launchQuestion(question)
                            .finally(() => {

                                launchButton.disabled =
                                    false;

                                launchButton.textContent =
                                    '▶ Запустить вопрос';

                            });

                    }
                );


                item.appendChild(
                    launchButton
                );


                /**
                 * Быстрый переход
                 */

                const scrollButton =
                    document.createElement('button');

                scrollButton.textContent =
                    ' ↓ К вопросу';

                Object.assign(
                    scrollButton.style,
                    {

                        cursor: 'pointer',

                        marginLeft: '6px',

                        padding:
                            '8px 12px',

                        borderRadius:
                            '5px',

                        border:
                            '1px solid #aaa',

                        background:
                            '#fff'

                    }
                );


                scrollButton.addEventListener(
                    'click',
                    () => {

                        const problem =
                            getProblem(question);

                        if (!problem) {
                            return;
                        }

                        showProblem(problem);

                        scrollToProblem(problem);

                    }
                );


                item.appendChild(
                    scrollButton
                );


                panel.appendChild(item);

            }
        );


        document.body.appendChild(panel);

    }


    /**
     * ---------------------------------------------------------
     * 11. Формат времени
     * ---------------------------------------------------------
     */

    function formatTime(seconds) {

        seconds =
            Math.floor(seconds);

        const minutes =
            Math.floor(seconds / 60);

        const sec =
            seconds % 60;

        return `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    }


    /**
     * ---------------------------------------------------------
     * 12. CSS подсветки
     * ---------------------------------------------------------
     */

    const style =
        document.createElement('style');

    style.textContent = `

        .quiz-navigator-active {
            outline: 3px solid rgba(0, 120, 255, .4) !important;
        }

        .quiz-navigator-highlight {
            animation:
                quizNavigatorPulse
                .7s ease-in-out
                4;
        }

        @keyframes quizNavigatorPulse {

            0% {
                box-shadow:
                    0 0 0
                    rgba(0, 120, 255, 0);
            }

            50% {
                box-shadow:
                    0 0 25px
                    rgba(0, 120, 255, .8);
            }

            100% {
                box-shadow:
                    0 0 0
                    rgba(0, 120, 255, 0);
            }

        }

    `;

    document.head.appendChild(style);


    /**
     * ---------------------------------------------------------
     * 13. Запуск
     * ---------------------------------------------------------
     */

    createPanel();

})();