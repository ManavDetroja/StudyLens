/**
 * Study Session UI Controller — Day 24.
 *
 * Orchestrates the unified, focused study session workflow:
 * - Dynamic Step Navigation: Overview → Learning Outputs → Flashcards → Quiz → Summary
 * - Reuses existing view modules without code duplication:
 *   - Learning Outputs via renderLearningOutputs
 *   - Flashcards via interactive flip & progression
 *   - Quizzes via interactive MCQ selection & recordQuizAttempt
 *   - Notes via openNoteEditor
 * - In-memory real-time session timer
 * - Accessible stepper navigation & keyboard shortcuts
 * - Persistent completion & abandonment in IndexedDB
 */

import { openDialog, closeDialog } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { formatSourceChunks, renderLearningOutputs } from './learningOutputView.js';
import { openNoteEditor } from './noteEditor.js';
import { calculateQuizResult } from '../processing/quizScoreCalculator.js';
import { recordQuizAttempt } from './quizAttemptService.js';
import { formatSessionDuration } from '../storage/studySessionValidation.js';
import {
    loadStudySessionData,
    startStudySession,
    getActiveSessionState,
    getActiveSessionElapsedMs,
    markStepCompleted,
    completeStudySession,
    abandonStudySession,
} from './studySessionService.js';

let activeData = null;
let currentStepIndex = 0;
let timerIntervalId = null;
let currentFlashcardIndex = 0;
let isFlashcardFlipped = false;
let currentQuizQuestionIndex = 0;
const userQuizAnswers = new Map();
let quizCompleted = false;
let quizResult = null;
let isSessionCompleted = false;

/* ── DOM Element Selectors ───────────────────────────────────────── */

function sessionDialog() {
    return document.getElementById('study-session-dialog');
}

function exitDialog() {
    return document.getElementById('study-session-exit-dialog');
}

function getStepperEl() {
    return document.querySelector('[data-study-session-stepper]');
}

function getTimerBadgeEl() {
    return document.querySelector('[data-study-session-timer]');
}

function getViewEl(viewId) {
    return document.querySelector(`[data-study-view="${viewId}"]`);
}

function getPrevBtn() {
    return document.querySelector('[data-study-session-prev]');
}

function getNextBtn() {
    return document.querySelector('[data-study-session-next]');
}

function getFinishBtn() {
    return document.querySelector('[data-study-session-finish]');
}

/* ── Timer Management ────────────────────────────────────────────── */

function startTimer() {
    stopTimer();
    updateTimerDisplay();
    timerIntervalId = setInterval(() => {
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    if (timerIntervalId) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
    }
}

function updateTimerDisplay() {
    const badge = getTimerBadgeEl();
    if (!badge) return;
    const elapsedMs = getActiveSessionElapsedMs();
    badge.textContent = formatSessionDuration(elapsedMs);
}

/* ── Stepper Navigation ──────────────────────────────────────────── */

function renderStepper() {
    const stepper = getStepperEl();
    if (!stepper || !activeData) return;

    stepper.replaceChildren();

    const activeState = getActiveSessionState();
    const completedSet = new Set(activeState?.session?.stepsCompleted || []);

    activeData.steps.forEach((step, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'study-stepper-btn';
        btn.dataset.stepIndex = String(index);
        btn.dataset.stepId = step.id;

        const isCurrent = index === currentStepIndex;
        const isDone = completedSet.has(step.id);

        if (isCurrent) {
            btn.classList.add('is-active');
            btn.setAttribute('aria-current', 'step');
        }

        if (isDone) {
            btn.classList.add('is-completed');
        }

        if (!step.available) {
            btn.classList.add('is-disabled');
            btn.disabled = true;
            btn.title = 'Not available for this resource';
        }

        const numSpan = document.createElement('span');
        numSpan.className = 'study-stepper-num';
        numSpan.textContent = isDone && !isCurrent ? '✓' : String(index + 1);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'study-stepper-label';
        labelSpan.textContent = step.label;

        btn.append(numSpan, labelSpan);

        btn.addEventListener('click', () => {
            if (!step.available) return;
            goToStep(index);
        });

        stepper.append(btn);
    });
}

/* ── Step Rendering ──────────────────────────────────────────────── */

function renderOverviewStep() {
    const grid = document.querySelector('[data-study-overview-grid]');
    if (!grid || !activeData) return;

    grid.replaceChildren();

    const activeState = getActiveSessionState();
    const completedSet = new Set(activeState?.session?.stepsCompleted || []);

    activeData.steps.forEach((step) => {
        const card = document.createElement('div');
        card.className = `study-overview-step-card ${step.available ? 'is-available' : 'is-unavailable'}`;

        const header = document.createElement('div');
        header.className = 'study-overview-step-header';

        const title = document.createElement('h4');
        title.className = 'study-overview-step-title';
        title.textContent = step.label;

        const badge = document.createElement('span');
        badge.className = 'badge';

        if (completedSet.has(step.id)) {
            badge.textContent = 'Completed';
            badge.classList.add('tone-blue');
        } else if (step.available) {
            badge.textContent = step.count > 0 && step.id !== 'overview' && step.id !== 'summary'
                ? `${step.count} items`
                : 'Ready';
            badge.classList.add('tone-amber');
        } else {
            badge.textContent = 'Unavailable';
        }

        header.append(title, badge);

        const desc = document.createElement('p');
        desc.className = 'study-overview-step-desc';
        desc.textContent = step.description;

        card.append(header, desc);
        grid.append(card);
    });

    markStepCompleted('overview');
}

function renderOutputsStep() {
    const container = document.querySelector('[data-study-outputs-container]');
    if (!container || !activeData) return;

    const outputs = activeData.outputs.filter((o) => o.type !== 'flashcard' && o.type !== 'quiz');
    if (outputs.length > 0) {
        renderLearningOutputs(container, {
            status: 'ready',
            outputs,
        });
    } else {
        renderLearningOutputs(container, {
            status: 'empty',
            emptyMessage: 'No learning outputs generated yet for this resource.',
        });
    }

    markStepCompleted('outputs');
}

function updateFlashcardUI() {
    const cards = activeData?.flashcards || [];
    const total = cards.length;

    const counter = document.querySelector('[data-study-flashcard-counter]');
    if (counter) {
        counter.textContent = total === 0 ? 'No flashcards' : `Card ${currentFlashcardIndex + 1} of ${total}`;
    }

    const progressBar = document.querySelector('[data-study-flashcard-progress-bar]');
    if (progressBar) {
        const pct = total === 0 ? 0 : Math.round(((currentFlashcardIndex + 1) / total) * 100);
        progressBar.style.width = `${pct}%`;
    }

    const prevBtn = document.querySelector('[data-study-flashcard-prev]');
    if (prevBtn) {
        prevBtn.disabled = currentFlashcardIndex <= 0;
    }

    const nextBtn = document.querySelector('[data-study-flashcard-next]');
    if (nextBtn) {
        nextBtn.disabled = currentFlashcardIndex >= total - 1;
    }

    const card = cards[currentFlashcardIndex];
    if (!card) return;

    const frontEl = document.querySelector('[data-study-flashcard-front]');
    const backEl = document.querySelector('[data-study-flashcard-back]');
    const cardEl = document.querySelector('[data-study-flashcard-card]');
    const sourceBadge = document.querySelector('[data-study-flashcard-source-badge]');

    isFlashcardFlipped = false;
    if (cardEl) {
        cardEl.classList.remove('is-flipped');
        cardEl.setAttribute('aria-expanded', 'false');
    }

    const content = card.content;
    const frontText = typeof content === 'object' && content ? content.front : String(content ?? '');
    const backText = typeof content === 'object' && content ? content.back : '';

    if (frontEl) frontEl.textContent = frontText;
    if (backEl) backEl.textContent = backText;

    if (sourceBadge) {
        const chunkText = formatSourceChunks(card.sourceChunkIds);
        if (chunkText) {
            sourceBadge.textContent = chunkText;
            sourceBadge.title = `Grounded in source ${chunkText}`;
            sourceBadge.hidden = false;
        } else {
            sourceBadge.textContent = '';
            sourceBadge.hidden = true;
        }
    }

    // Mark completed if on or reached last card
    if (currentFlashcardIndex >= total - 1) {
        markStepCompleted('flashcards');
    }
}

function flipActiveFlashcard() {
    const cardEl = document.querySelector('[data-study-flashcard-card]');
    if (!cardEl) return;

    isFlashcardFlipped = !isFlashcardFlipped;
    cardEl.classList.toggle('is-flipped', isFlashcardFlipped);
    cardEl.setAttribute('aria-expanded', String(isFlashcardFlipped));
}

function renderFlashcardsStep() {
    updateFlashcardUI();
}

function updateQuizQuestionUI() {
    const quiz = activeData?.quiz;
    if (!quiz || !quiz.questions || quiz.questions.length === 0) return;

    const total = quiz.questions.length;
    const q = quiz.questions[currentQuizQuestionIndex];
    if (!q) return;

    const counter = document.querySelector('[data-study-quiz-counter]');
    if (counter) {
        counter.textContent = `Question ${currentQuizQuestionIndex + 1} of ${total}`;
    }

    const progressBar = document.querySelector('[data-study-quiz-progress-bar]');
    if (progressBar) {
        const pct = Math.round(((currentQuizQuestionIndex + 1) / total) * 100);
        progressBar.style.width = `${pct}%`;
    }

    const sourceBadge = document.querySelector('[data-study-quiz-source-badge]');
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

    const questionTextEl = document.querySelector('[data-study-quiz-question-text]');
    if (questionTextEl) {
        questionTextEl.textContent = q.question;
    }

    const optionsList = document.querySelector('[data-study-quiz-options-list]');
    if (optionsList) {
        optionsList.replaceChildren();

        const selectedAnswer = userQuizAnswers.get(q.id);

        q.options.forEach((optText, optIndex) => {
            const optBtn = document.createElement('button');
            optBtn.type = 'button';
            optBtn.className = 'quiz-option-button';
            optBtn.setAttribute('role', 'radio');

            const isSelected = selectedAnswer === optText;
            optBtn.setAttribute('aria-checked', String(isSelected));
            if (isSelected) {
                optBtn.classList.add('is-selected');
            }

            const indicator = document.createElement('span');
            indicator.className = 'quiz-option-indicator';
            indicator.textContent = String.fromCharCode(65 + optIndex); // A, B, C, D

            const textSpan = document.createElement('span');
            textSpan.className = 'quiz-option-text';
            textSpan.textContent = optText;

            optBtn.append(indicator, textSpan);

            optBtn.addEventListener('click', () => {
                userQuizAnswers.set(q.id, optText);
                updateQuizQuestionUI();
            });

            optionsList.append(optBtn);
        });
    }

    const prevBtn = document.querySelector('[data-study-quiz-prev]');
    const nextBtn = document.querySelector('[data-study-quiz-next]');
    const submitBtn = document.querySelector('[data-study-quiz-submit]');

    const isFirst = currentQuizQuestionIndex <= 0;
    const isLast = currentQuizQuestionIndex >= total - 1;

    if (prevBtn) prevBtn.disabled = isFirst;
    if (nextBtn) nextBtn.hidden = isLast;
    if (submitBtn) submitBtn.hidden = !isLast;
}

async function handleQuizSubmit() {
    const quiz = activeData?.quiz;
    if (!quiz) return;

    const submitBtn = document.querySelector('[data-study-quiz-submit]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
    }

    try {
        const result = calculateQuizResult(quiz, userQuizAnswers);
        const attempt = await recordQuizAttempt(quiz, userQuizAnswers, {
            startedAt: activeData.session.startedAt,
            metadata: { studySessionId: activeData.session.id },
        });

        quizCompleted = true;
        quizResult = result;
        markStepCompleted('quiz');

        renderQuizResultsUI(result);
        renderStepper();
    } catch (err) {
        console.error('StudyLens could not evaluate quiz attempt:', err);
        showToast('Could not record quiz results: ' + (err.message || 'Please try again.'), { variant: 'error' });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit quiz';
        }
    }
}

function renderQuizResultsUI(result) {
    const activeSection = document.querySelector('[data-study-quiz-active]');
    const resultsSection = document.querySelector('[data-study-quiz-results]');
    if (activeSection) activeSection.hidden = true;
    if (resultsSection) resultsSection.hidden = false;

    const banner = document.querySelector('[data-study-quiz-score-banner]');
    if (banner) {
        banner.textContent = `${result.score} / ${result.totalQuestions} (${result.percentage}%)`;
    }

    const statsEl = document.querySelector('[data-study-quiz-score-stats]');
    if (statsEl) {
        statsEl.replaceChildren();

        const correctChip = document.createElement('span');
        correctChip.className = 'badge quiz-badge-correct';
        correctChip.textContent = `✓ ${result.correctCount} Correct`;

        const incorrectChip = document.createElement('span');
        incorrectChip.className = 'badge quiz-badge-incorrect';
        incorrectChip.textContent = `✗ ${result.incorrectCount} Incorrect`;

        statsEl.append(correctChip, incorrectChip);

        if (result.unansweredCount > 0) {
            const unansweredChip = document.createElement('span');
            unansweredChip.className = 'badge quiz-badge-unanswered';
            unansweredChip.textContent = `○ ${result.unansweredCount} Unanswered`;
            statsEl.append(unansweredChip);
        }
    }

    const breakdownEl = document.querySelector('[data-study-quiz-results-breakdown]');
    if (breakdownEl) {
        breakdownEl.replaceChildren();

        result.questionResults.forEach((qr, idx) => {
            const item = document.createElement('div');
            item.className = `quiz-result-item ${qr.isCorrect ? 'is-correct' : (qr.userAnswer ? 'is-incorrect' : 'is-unanswered')}`;

            const header = document.createElement('div');
            header.className = 'quiz-result-header';

            const qTitle = document.createElement('h4');
            qTitle.className = 'quiz-result-q-title';
            qTitle.textContent = `${idx + 1}. ${qr.question}`;

            const statusBadge = document.createElement('span');
            statusBadge.className = `badge ${qr.isCorrect ? 'quiz-badge-correct' : 'quiz-badge-incorrect'}`;
            statusBadge.textContent = qr.isCorrect ? 'Correct' : (qr.userAnswer ? 'Incorrect' : 'Unanswered');

            header.append(qTitle, statusBadge);
            item.append(header);

            if (!qr.isCorrect) {
                const details = document.createElement('div');
                details.className = 'quiz-result-details';

                if (qr.userAnswer) {
                    const yourAns = document.createElement('p');
                    yourAns.className = 'quiz-result-your-answer';
                    yourAns.textContent = `Your answer: ${qr.userAnswer}`;
                    details.append(yourAns);
                }

                const correctAns = document.createElement('p');
                correctAns.className = 'quiz-result-correct-answer';
                correctAns.textContent = `Correct answer: ${qr.correctAnswer}`;
                details.append(correctAns);

                item.append(details);
            }

            breakdownEl.append(item);
        });
    }
}

function renderQuizStep() {
    const activeSection = document.querySelector('[data-study-quiz-active]');
    const resultsSection = document.querySelector('[data-study-quiz-results]');

    if (quizCompleted && quizResult) {
        if (activeSection) activeSection.hidden = true;
        if (resultsSection) resultsSection.hidden = false;
        renderQuizResultsUI(quizResult);
    } else {
        if (activeSection) activeSection.hidden = false;
        if (resultsSection) resultsSection.hidden = true;
        updateQuizQuestionUI();
    }
}

async function renderSummaryStep() {
    stopTimer();
    const activeState = getActiveSessionState();
    const elapsedMs = getActiveSessionElapsedMs();
    const durationFormatted = formatSessionDuration(elapsedMs);

    // Save completed session to IndexedDB
    if (!isSessionCompleted && activeState) {
        try {
            await completeStudySession({
                durationFormatted,
                quizScore: quizResult ? `${quizResult.score}/${quizResult.totalQuestions}` : null,
                quizPercentage: quizResult ? quizResult.percentage : null,
            });
            isSessionCompleted = true;
        } catch (err) {
            console.warn('StudyLens could not complete study session persistence:', err);
        }
    }

    const grid = document.querySelector('[data-study-summary-stats-grid]');
    if (!grid || !activeData) return;

    grid.replaceChildren();

    // 1. Time Studied
    const timeBox = document.createElement('div');
    timeBox.className = 'study-summary-stat-box';
    const timeVal = document.createElement('strong');
    timeVal.textContent = durationFormatted;
    const timeLbl = document.createElement('span');
    timeLbl.textContent = 'Total time studied';
    timeBox.append(timeVal, timeLbl);

    // 2. Steps Finished
    const completedSet = new Set(activeState?.session?.stepsCompleted || ['overview', 'summary']);
    const availableSteps = activeData.steps.filter((s) => s.available);
    const completedCount = availableSteps.filter((s) => completedSet.has(s.id)).length;

    const stepsBox = document.createElement('div');
    stepsBox.className = 'study-summary-stat-box';
    const stepsVal = document.createElement('strong');
    stepsVal.textContent = `${completedCount} of ${availableSteps.length}`;
    const stepsLbl = document.createElement('span');
    stepsLbl.textContent = 'Steps completed';
    stepsBox.append(stepsVal, stepsLbl);

    // 3. Flashcards reviewed
    const hasFlashcards = activeData.steps.find((s) => s.id === 'flashcards')?.available;
    const cardsBox = document.createElement('div');
    cardsBox.className = 'study-summary-stat-box';
    const cardsVal = document.createElement('strong');
    cardsVal.textContent = hasFlashcards ? `${activeData.flashcards.length} cards` : 'None';
    const cardsLbl = document.createElement('span');
    cardsLbl.textContent = 'Flashcards reviewed';
    cardsBox.append(cardsVal, cardsLbl);

    // 4. Quiz accuracy
    const hasQuiz = activeData.steps.find((s) => s.id === 'quiz')?.available;
    const quizBox = document.createElement('div');
    quizBox.className = 'study-summary-stat-box';
    const quizVal = document.createElement('strong');
    quizVal.textContent = quizResult ? `${quizResult.percentage}%` : (hasQuiz ? 'Skipped' : 'None');
    const quizLbl = document.createElement('span');
    quizLbl.textContent = 'Quiz score';
    quizBox.append(quizVal, quizLbl);

    grid.append(timeBox, stepsBox, cardsBox, quizBox);
    renderStepper();
}

/* ── Navigation Engine ───────────────────────────────────────────── */

function goToStep(targetIndex) {
    if (!activeData || targetIndex < 0 || targetIndex >= activeData.steps.length) return;

    const targetStep = activeData.steps[targetIndex];
    if (!targetStep.available) {
        // Find next available forward
        const nextAvail = activeData.steps.findIndex((s, idx) => idx > targetIndex && s.available);
        if (nextAvail !== -1) {
            goToStep(nextAvail);
            return;
        }
        return;
    }

    currentStepIndex = targetIndex;

    // Toggle view elements
    activeData.steps.forEach((step) => {
        const viewEl = getViewEl(step.id);
        if (viewEl) {
            viewEl.hidden = step.id !== targetStep.id;
        }
    });

    renderStepper();

    // Render active step
    switch (targetStep.id) {
        case 'overview':
            renderOverviewStep();
            break;
        case 'outputs':
            renderOutputsStep();
            break;
        case 'flashcards':
            renderFlashcardsStep();
            break;
        case 'quiz':
            renderQuizStep();
            break;
        case 'summary':
            void renderSummaryStep();
            break;
    }

    // Update bottom footer buttons
    const prevBtn = getPrevBtn();
    const nextBtn = getNextBtn();
    const finishBtn = getFinishBtn();

    if (prevBtn) {
        // Disabled if on first available step
        const firstAvailIndex = activeData.steps.findIndex((s) => s.available);
        prevBtn.disabled = currentStepIndex <= firstAvailIndex;
    }

    if (targetStep.id === 'summary') {
        if (nextBtn) nextBtn.hidden = true;
        if (finishBtn) finishBtn.hidden = false;
    } else {
        if (nextBtn) nextBtn.hidden = false;
        if (finishBtn) finishBtn.hidden = true;

        // Check if there is another step before summary
        const nextAvailIndex = activeData.steps.findIndex((s, idx) => idx > currentStepIndex && s.available);
        if (nextAvailIndex === activeData.steps.length - 1) {
            nextBtn.textContent = 'Finish session';
        } else {
            nextBtn.textContent = 'Continue';
        }
    }
}

function nextStep() {
    if (!activeData) return;
    const nextAvailIndex = activeData.steps.findIndex((s, idx) => idx > currentStepIndex && s.available);
    if (nextAvailIndex !== -1) {
        goToStep(nextAvailIndex);
    }
}

function prevStep() {
    if (!activeData) return;
    // Search backward
    for (let i = currentStepIndex - 1; i >= 0; i--) {
        if (activeData.steps[i].available) {
            goToStep(i);
            return;
        }
    }
}

/* ── Public Launcher ─────────────────────────────────────────────── */

/**
 * Open Study Session modal for a resource.
 *
 * @param {string} resourceId
 */
export async function openStudySession(resourceId) {
    if (!resourceId) return;

    try {
        const startResult = await startStudySession(resourceId);
        activeData = {
            ...startResult.data,
            session: startResult.session,
        };
        currentStepIndex = 0;
        currentFlashcardIndex = 0;
        isFlashcardFlipped = false;
        currentQuizQuestionIndex = 0;
        userQuizAnswers.clear();
        quizCompleted = false;
        quizResult = null;
        isSessionCompleted = false;

        // Set Dialog Title
        const titleEl = document.querySelector('[data-study-session-title]');
        if (titleEl) {
            titleEl.textContent = `Study: ${activeData.resource.title}`;
        }

        renderStepper();
        startTimer();
        goToStep(0);
        openDialog(sessionDialog());
    } catch (err) {
        console.error('StudyLens could not start study session:', err);
        showToast(err.message || 'Could not start study session for this resource.', { variant: 'error' });
    }
}

/* ── Event Listener Bindings ─────────────────────────────────────── */

let isInitialized = false;

export function initStudySessionUI() {
    if (isInitialized) return;
    isInitialized = true;

    // Navigation buttons
    getPrevBtn()?.addEventListener('click', () => prevStep());
    getNextBtn()?.addEventListener('click', () => nextStep());

    getFinishBtn()?.addEventListener('click', () => {
        closeDialog(sessionDialog());
        showToast('Study session completed! Great job.');
    });

    // Exit & Cancel buttons
    const triggerExit = () => {
        if (isSessionCompleted) {
            closeDialog(sessionDialog());
            return;
        }
        openDialog(exitDialog());
    };

    document.querySelector('[data-study-session-cancel]')?.addEventListener('click', triggerExit);
    document.querySelector('[data-study-session-exit]')?.addEventListener('click', triggerExit);

    // Confirm exit dialog
    document.querySelector('[data-study-session-confirm-exit]')?.addEventListener('click', async () => {
        await abandonStudySession();
        stopTimer();
        closeDialog(exitDialog());
        closeDialog(sessionDialog());
        showToast('Study session ended.');
    });

    // Note action
    document.querySelector('[data-study-session-note]')?.addEventListener('click', () => {
        if (!activeData?.resource) return;
        void openNoteEditor({
            resourceId: activeData.resource.id,
            title: `Notes — ${activeData.resource.title}`,
        });
    });

    // Flashcard actions
    document.querySelector('[data-study-flashcard-flip]')?.addEventListener('click', flipActiveFlashcard);
    document.querySelector('[data-study-flashcard-card]')?.addEventListener('click', flipActiveFlashcard);

    document.querySelector('[data-study-flashcard-prev]')?.addEventListener('click', () => {
        if (currentFlashcardIndex > 0) {
            currentFlashcardIndex--;
            updateFlashcardUI();
        }
    });

    document.querySelector('[data-study-flashcard-next]')?.addEventListener('click', () => {
        if (activeData?.flashcards && currentFlashcardIndex < activeData.flashcards.length - 1) {
            currentFlashcardIndex++;
            updateFlashcardUI();
        }
    });

    // Quiz actions
    document.querySelector('[data-study-quiz-prev]')?.addEventListener('click', () => {
        if (currentQuizQuestionIndex > 0) {
            currentQuizQuestionIndex--;
            updateQuizQuestionUI();
        }
    });

    document.querySelector('[data-study-quiz-next]')?.addEventListener('click', () => {
        if (activeData?.quiz?.questions && currentQuizQuestionIndex < activeData.quiz.questions.length - 1) {
            currentQuizQuestionIndex++;
            updateQuizQuestionUI();
        }
    });

    document.querySelector('[data-study-quiz-submit]')?.addEventListener('click', () => {
        void handleQuizSubmit();
    });

    // Keyboard navigation (Flashcards)
    document.addEventListener('keydown', (e) => {
        const dialog = sessionDialog();
        if (!dialog || !dialog.open) return;

        const currentStep = activeData?.steps?.[currentStepIndex];
        if (currentStep?.id === 'flashcards') {
            if (e.key === ' ' || e.key === 'Enter') {
                if (document.activeElement?.tagName !== 'BUTTON') {
                    e.preventDefault();
                    flipActiveFlashcard();
                }
            } else if (e.key === 'ArrowRight') {
                if (activeData?.flashcards && currentFlashcardIndex < activeData.flashcards.length - 1) {
                    currentFlashcardIndex++;
                    updateFlashcardUI();
                }
            } else if (e.key === 'ArrowLeft') {
                if (currentFlashcardIndex > 0) {
                    currentFlashcardIndex--;
                    updateFlashcardUI();
                }
            }
        }
    });

    // Clean up timer when modal closes
    sessionDialog()?.addEventListener('close', () => {
        stopTimer();
    });
}
