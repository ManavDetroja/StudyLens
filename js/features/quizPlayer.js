/**
 * Interactive Quiz Player UI Controller — Day 13 & Day 14.
 *
 * Provides a modal study session for quizzes:
 * - One question at a time with clear selectable options
 * - Navigation: Previous and Next buttons preserving answer selections
 * - Progress indicator ("Question X of Y") and completion progress bar
 * - Submission calculation: evaluates score, accuracy, and question breakdown
 * - Persistent attempt records in IndexedDB via quizAttemptService
 * - Result screen with score banner, stats chips, and question breakdown
 * - Attempt history view: lists past attempts for this quiz with review capability
 * - Review mode for historical attempts (inspect past answers safely)
 * - Retry action: resets answers and restarts at question 1 without creating empty attempts
 * - Safe text rendering (textContent only)
 * - Source chunk traceability badge display
 */

import { openDialog } from '../ui/modal.js';
import { formatSourceChunks } from './learningOutputView.js';
import { recordQuizAttempt, getAttemptsForQuiz } from './quizAttemptService.js';
import { calculateQuizResult } from '../processing/quizScoreCalculator.js';

let activeQuiz = null;
let currentQuestionIndex = 0;
const userAnswers = new Map(); // questionId -> selectedOptionText
let isSubmitted = false;
let sessionStartedAt = null;

function playerDialog() {
    return document.getElementById('quiz-player-dialog');
}

/**
 * Formats an ISO date string for display in attempt history.
 *
 * @param {string} isoString
 * @returns {string}
 */
export function formatAttemptDate(isoString) {
    if (!isoString) return 'Recent';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Recent';
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

function updateControls() {
    if (!activeQuiz) return;

    const total = activeQuiz.questions.length;
    const isFirst = currentQuestionIndex <= 0;
    const isLast = currentQuestionIndex >= total - 1;

    const prevBtn = document.querySelector('[data-quiz-prev]');
    const nextBtn = document.querySelector('[data-quiz-next]');
    const submitBtn = document.querySelector('[data-quiz-submit]');

    if (prevBtn) {
        prevBtn.disabled = isFirst;
    }

    if (nextBtn) {
        nextBtn.hidden = isLast;
    }

    if (submitBtn) {
        submitBtn.hidden = !isLast;
    }
}

function renderCurrentQuestion() {
    if (!activeQuiz || !activeQuiz.questions.length) return;

    const total = activeQuiz.questions.length;
    const q = activeQuiz.questions[currentQuestionIndex];
    if (!q) return;

    // Progress counter and bar
    const counterEl = document.querySelector('[data-quiz-progress-counter]');
    if (counterEl) {
        counterEl.textContent = `Question ${currentQuestionIndex + 1} of ${total}`;
    }

    const progressBar = document.querySelector('[data-quiz-progress-bar]');
    if (progressBar) {
        const pct = Math.round(((currentQuestionIndex + 1) / total) * 100);
        progressBar.style.width = `${pct}%`;
    }

    // Source badge
    const sourceBadge = document.querySelector('[data-quiz-source-badge]');
    if (sourceBadge) {
        const chunkText = formatSourceChunks(q.sourceChunkIds);
        if (chunkText) {
            sourceBadge.textContent = chunkText;
            sourceBadge.title = `Grounded in source ${chunkText}`;
            sourceBadge.hidden = false;
        } else {
            sourceBadge.textContent = '';
            sourceBadge.hidden = true;
        }
    }

    // Question text (safe rendering)
    const questionTextEl = document.querySelector('[data-quiz-question-text]');
    if (questionTextEl) {
        questionTextEl.textContent = q.question;
    }

    // Options list (safe rendering via textContent)
    const optionsContainer = document.querySelector('[data-quiz-options-list]');
    if (optionsContainer) {
        optionsContainer.replaceChildren();

        const selectedAnswer = userAnswers.get(q.id);

        q.options.forEach((optText, optIdx) => {
            const optionCard = document.createElement('button');
            optionCard.type = 'button';
            optionCard.className = 'quiz-option-button';
            optionCard.dataset.optionIndex = String(optIdx);

            const isSelected = selectedAnswer === optText;
            if (isSelected) {
                optionCard.classList.add('is-selected');
                optionCard.setAttribute('aria-pressed', 'true');
            } else {
                optionCard.setAttribute('aria-pressed', 'false');
            }

            const indicator = document.createElement('span');
            indicator.className = 'quiz-option-indicator';
            indicator.textContent = String.fromCharCode(65 + optIdx); // A, B, C, D

            const textSpan = document.createElement('span');
            textSpan.className = 'quiz-option-text';
            textSpan.textContent = optText;

            optionCard.append(indicator, textSpan);

            optionCard.addEventListener('click', () => {
                userAnswers.set(q.id, optText);
                renderCurrentQuestion();
            });

            optionsContainer.append(optionCard);
        });
    }

    updateControls();
}

export function selectAnswer(questionId, optionText) {
    userAnswers.set(questionId, optionText);
    renderCurrentQuestion();
}

export function nextQuestion() {
    if (!activeQuiz) return;
    if (currentQuestionIndex < activeQuiz.questions.length - 1) {
        currentQuestionIndex++;
        renderCurrentQuestion();
    }
}

export function prevQuestion() {
    if (!activeQuiz) return;
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderCurrentQuestion();
    }
}

/**
 * Renders the results view for an attempt or calculated result.
 *
 * @param {object} result — calculation or attempt record
 * @param {object} [options]
 * @param {boolean} [options.isHistorical=false]
 */
export function renderResultsView(result, options = {}) {
    const isHistorical = options.isHistorical ?? false;

    const questionView = document.querySelector('[data-quiz-question-view]');
    const resultsView = document.querySelector('[data-quiz-results-view]');
    const historyView = document.querySelector('[data-quiz-history-view]');

    if (questionView) questionView.hidden = true;
    if (historyView) historyView.hidden = true;
    if (resultsView) resultsView.hidden = false;

    // Score banner
    const scoreBanner = document.querySelector('[data-quiz-score-banner]');
    if (scoreBanner) {
        scoreBanner.textContent = `${result.score} / ${result.totalQuestions} Correct (${result.percentage}%)`;
    }

    // Score stats chips
    const scoreStats = document.querySelector('[data-quiz-score-stats]');
    if (scoreStats) {
        scoreStats.replaceChildren();

        const correctBadge = document.createElement('span');
        correctBadge.className = 'badge quiz-badge-correct';
        correctBadge.textContent = `${result.correctCount} Correct`;

        const incorrectBadge = document.createElement('span');
        incorrectBadge.className = 'badge quiz-badge-incorrect';
        incorrectBadge.textContent = `${result.incorrectCount} Incorrect`;

        scoreStats.append(correctBadge, incorrectBadge);

        if (result.unansweredCount > 0) {
            const unansweredBadge = document.createElement('span');
            unansweredBadge.className = 'badge quiz-badge-unanswered';
            unansweredBadge.textContent = `${result.unansweredCount} Unanswered`;
            scoreStats.append(unansweredBadge);
        }

        if (isHistorical && result.completedAt) {
            const dateBadge = document.createElement('span');
            dateBadge.className = 'badge';
            dateBadge.textContent = `Completed ${formatAttemptDate(result.completedAt)}`;
            scoreStats.append(dateBadge);
        }
    }

    // Results breakdown
    const breakdownContainer = document.querySelector('[data-quiz-results-breakdown]');
    if (breakdownContainer) {
        breakdownContainer.replaceChildren();

        const qResults = Array.isArray(result.questionResults) ? result.questionResults : [];

        qResults.forEach((qr, idx) => {
            const item = document.createElement('div');
            item.className = `quiz-result-item ${qr.isCorrect ? 'is-correct' : qr.isUnanswered ? 'is-unanswered' : 'is-incorrect'}`;

            const itemHeader = document.createElement('div');
            itemHeader.className = 'quiz-result-header';

            const qTitle = document.createElement('h4');
            qTitle.className = 'quiz-result-q-title';
            qTitle.textContent = `Q${idx + 1}: ${qr.question}`;

            const badge = document.createElement('span');
            if (qr.isCorrect) {
                badge.className = 'badge quiz-badge-correct';
                badge.textContent = 'Correct';
            } else if (qr.isUnanswered) {
                badge.className = 'badge quiz-badge-unanswered';
                badge.textContent = 'Unanswered';
            } else {
                badge.className = 'badge quiz-badge-incorrect';
                badge.textContent = 'Incorrect';
            }

            itemHeader.append(qTitle, badge);
            item.append(itemHeader);

            if (!qr.isCorrect) {
                const details = document.createElement('div');
                details.className = 'quiz-result-details';

                const yourAns = document.createElement('p');
                yourAns.className = 'quiz-result-your-answer';
                yourAns.textContent = `Your answer: ${qr.selectedAnswer ? qr.selectedAnswer : '(Unanswered)'}`;

                const correctAns = document.createElement('p');
                correctAns.className = 'quiz-result-correct-answer';
                correctAns.textContent = `Correct answer: ${qr.correctAnswer}`;

                details.append(yourAns, correctAns);
                item.append(details);
            }

            if (Array.isArray(qr.sourceChunkIds) && qr.sourceChunkIds.length > 0) {
                const chunkText = formatSourceChunks(qr.sourceChunkIds);
                if (chunkText) {
                    const sourceSpan = document.createElement('span');
                    sourceSpan.className = 'badge quiz-source-badge';
                    sourceSpan.textContent = chunkText;
                    item.append(sourceSpan);
                }
            }

            breakdownContainer.append(item);
        });
    }
}

/**
 * Loads and displays past attempts for the active quiz.
 */
export async function showQuizHistory() {
    if (!activeQuiz) return;

    const questionView = document.querySelector('[data-quiz-question-view]');
    const resultsView = document.querySelector('[data-quiz-results-view]');
    const historyView = document.querySelector('[data-quiz-history-view]');
    const historyList = document.querySelector('[data-quiz-history-list]');

    if (questionView) questionView.hidden = true;
    if (resultsView) resultsView.hidden = true;
    if (historyView) historyView.hidden = false;

    if (!historyList) return;
    historyList.replaceChildren();

    try {
        const attempts = await getAttemptsForQuiz(activeQuiz.id);

        if (attempts.length === 0) {
            const emptyNotice = document.createElement('p');
            emptyNotice.className = 'form-helper';
            emptyNotice.textContent = 'No past attempts recorded for this quiz yet.';
            historyList.append(emptyNotice);
            return;
        }

        attempts.forEach((attempt) => {
            const card = document.createElement('article');
            card.className = 'quiz-history-item';

            const header = document.createElement('div');
            header.className = 'quiz-history-item-header';

            const dateSpan = document.createElement('span');
            dateSpan.className = 'quiz-history-date';
            dateSpan.textContent = formatAttemptDate(attempt.completedAt || attempt.createdAt);

            const scoreBadge = document.createElement('span');
            scoreBadge.className = 'badge quiz-history-score-badge';
            scoreBadge.textContent = `${attempt.score} / ${attempt.totalQuestions} (${attempt.percentage}%)`;

            header.append(dateSpan, scoreBadge);

            const stats = document.createElement('div');
            stats.className = 'quiz-history-stats';

            const correctSpan = document.createElement('span');
            correctSpan.textContent = `${attempt.correctCount} correct`;

            const incorrectSpan = document.createElement('span');
            incorrectSpan.textContent = `${attempt.incorrectCount} incorrect`;

            stats.append(correctSpan, incorrectSpan);

            if (attempt.unansweredCount > 0) {
                const unansweredSpan = document.createElement('span');
                unansweredSpan.textContent = `${attempt.unansweredCount} unanswered`;
                stats.append(unansweredSpan);
            }

            const reviewBtn = document.createElement('button');
            reviewBtn.className = 'button button-secondary button-small';
            reviewBtn.type = 'button';
            reviewBtn.textContent = 'Review';
            reviewBtn.addEventListener('click', () => {
                renderResultsView(attempt, { isHistorical: true });
            });

            card.append(header, stats, reviewBtn);
            historyList.append(card);
        });
    } catch (err) {
        console.error('StudyLens could not load quiz attempt history.', err);
        const errorNotice = document.createElement('p');
        errorNotice.className = 'form-error';
        errorNotice.textContent = 'Could not load past attempts.';
        historyList.append(errorNotice);
    }
}

/**
 * Submits the current quiz, evaluates score, persists the attempt record,
 * and renders the results breakdown.
 */
export async function submitQuiz() {
    if (!activeQuiz) return;

    isSubmitted = true;
    const completedAt = new Date().toISOString();
    let result = null;

    try {
        result = await recordQuizAttempt(activeQuiz, userAnswers, {
            startedAt: sessionStartedAt || completedAt,
            completedAt,
        });
    } catch (err) {
        console.error('StudyLens could not persist quiz attempt.', err);
        // Fallback to deterministic calculation so user is never blocked
        result = calculateQuizResult(activeQuiz, userAnswers);
    }

    renderResultsView(result);
}

/**
 * Resets user answers and restarts the quiz session at question 1.
 * Does NOT persist any attempt until the user explicitly submits again.
 */
export function retryQuiz() {
    if (!activeQuiz) return;

    userAnswers.clear();
    currentQuestionIndex = 0;
    isSubmitted = false;
    sessionStartedAt = new Date().toISOString();

    const questionView = document.querySelector('[data-quiz-question-view]');
    const resultsView = document.querySelector('[data-quiz-results-view]');
    const historyView = document.querySelector('[data-quiz-history-view]');

    if (questionView) questionView.hidden = false;
    if (resultsView) resultsView.hidden = true;
    if (historyView) historyView.hidden = true;

    renderCurrentQuestion();
}

/**
 * Opens the quiz player for a given quiz definition.
 *
 * @param {object} quiz — Quiz record
 * @param {object} [options]
 * @param {'question'|'history'} [options.initialView='question']
 */
export function openQuizPlayer(quiz, options = {}) {
    if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
        return;
    }

    activeQuiz = quiz;
    currentQuestionIndex = 0;
    userAnswers.clear();
    isSubmitted = false;
    sessionStartedAt = new Date().toISOString();

    const titleEl = document.querySelector('[data-quiz-player-title]');
    if (titleEl) {
        titleEl.textContent = quiz.title || 'Quiz Session';
    }

    const questionView = document.querySelector('[data-quiz-question-view]');
    const resultsView = document.querySelector('[data-quiz-results-view]');
    const historyView = document.querySelector('[data-quiz-history-view]');

    const dialog = playerDialog();
    if (!dialog) return;

    if (options.initialView === 'history') {
        if (questionView) questionView.hidden = true;
        if (resultsView) resultsView.hidden = true;
        if (historyView) historyView.hidden = false;
        void showQuizHistory();
    } else {
        if (questionView) questionView.hidden = false;
        if (resultsView) resultsView.hidden = true;
        if (historyView) historyView.hidden = true;
        renderCurrentQuestion();
    }

    openDialog(dialog);
}

export function initQuizPlayer() {
    const dialog = playerDialog();
    if (!dialog) return;

    document.querySelector('[data-quiz-prev]')?.addEventListener('click', () => {
        prevQuestion();
    });

    document.querySelector('[data-quiz-next]')?.addEventListener('click', () => {
        nextQuestion();
    });

    document.querySelector('[data-quiz-submit]')?.addEventListener('click', () => {
        void submitQuiz();
    });

    document.querySelectorAll('[data-quiz-retry]').forEach((btn) => {
        btn.addEventListener('click', () => {
            retryQuiz();
        });
    });

    document.querySelector('[data-quiz-view-history]')?.addEventListener('click', () => {
        void showQuizHistory();
    });

    document.querySelector('[data-quiz-history-back]')?.addEventListener('click', () => {
        const questionView = document.querySelector('[data-quiz-question-view]');
        const resultsView = document.querySelector('[data-quiz-results-view]');
        const historyView = document.querySelector('[data-quiz-history-view]');

        if (historyView) historyView.hidden = true;

        if (isSubmitted) {
            if (resultsView) resultsView.hidden = false;
            if (questionView) questionView.hidden = true;
        } else {
            if (questionView) questionView.hidden = false;
            if (resultsView) resultsView.hidden = true;
        }
    });

    dialog.addEventListener('close', () => {
        // Reset transient player state
        activeQuiz = null;
        userAnswers.clear();
        currentQuestionIndex = 0;
        isSubmitted = false;
        sessionStartedAt = null;
    });
}
