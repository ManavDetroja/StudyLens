/**
 * Quizzes Page Feature Module — Day 13 & Day 14.
 *
 * Manages the Quizzes main section (#quizzes):
 * - Displays available quizzes generated from study resources
 * - Shows quiz title, question count badge, and actions
 * - Direct triggers for "Take quiz" and "History" (view past attempts)
 * - Renders friendly empty state when no quizzes exist with guidance to generate from Library
 * - Reactively refreshes quizzes when storage events fire (quizzes, resources, attempts)
 * - Launches the Quiz Player modal for interactive practice sessions or history review
 */

import { getAllQuizzes } from './quizService.js';
import { openQuizPlayer } from './quizPlayer.js';
import { onQuizzesChanged, onResourcesChanged, onQuizAttemptsChanged } from '../core/resourceEvents.js';

let activeQuizzes = [];

/**
 * Creates a DOM card for a single quiz.
 *
 * @param {object} quiz — validated Quiz record
 * @returns {HTMLElement}
 */
export function createQuizCard(quiz) {
    const card = document.createElement('article');
    card.className = 'card quiz-deck-card';
    card.dataset.quizId = quiz.id;
    card.dataset.resourceId = quiz.resourceId;

    const header = document.createElement('div');
    header.className = 'quiz-card-header';

    const title = document.createElement('h2');
    title.className = 'quiz-card-title';
    title.textContent = quiz.title;
    header.append(title);

    const badge = document.createElement('span');
    badge.className = 'badge quiz-card-badge';
    const qCount = quiz.questions?.length ?? 0;
    badge.textContent = `${qCount} question${qCount === 1 ? '' : 's'}`;
    header.append(badge);

    card.append(header);

    // Preview snippet of the first question
    if (quiz.questions && quiz.questions.length > 0) {
        const firstQ = quiz.questions[0];
        const preview = document.createElement('p');
        preview.className = 'quiz-card-preview';
        preview.textContent = `Q1: ${firstQ.question}`;
        card.append(preview);
    }

    const actions = document.createElement('div');
    actions.className = 'quiz-card-actions';

    const historyBtn = document.createElement('button');
    historyBtn.className = 'button button-secondary';
    historyBtn.type = 'button';
    historyBtn.textContent = 'History';
    historyBtn.dataset.quizHistory = quiz.id;
    historyBtn.addEventListener('click', () => {
        openQuizPlayer(quiz, { initialView: 'history' });
    });

    const startBtn = document.createElement('button');
    startBtn.className = 'button button-primary';
    startBtn.type = 'button';
    startBtn.textContent = 'Take quiz';
    startBtn.dataset.startQuiz = quiz.id;
    startBtn.addEventListener('click', () => {
        openQuizPlayer(quiz);
    });

    actions.append(historyBtn, startBtn);
    card.append(actions);

    return card;
}

/**
 * Renders quiz cards or empty state into the Quizzes page container.
 *
 * @param {Array<object>} quizzes
 */
export function renderQuizzesList(quizzes) {
    const emptyEl = document.querySelector('[data-quizzes-empty]');
    const listContainer = document.querySelector('[data-quizzes-list]');

    if (!emptyEl || !listContainer) return;

    activeQuizzes = quizzes;

    if (!quizzes || quizzes.length === 0) {
        emptyEl.hidden = false;
        listContainer.hidden = true;
        listContainer.replaceChildren();
        return;
    }

    emptyEl.hidden = true;
    listContainer.hidden = false;
    listContainer.replaceChildren();

    quizzes.forEach((quiz) => {
        listContainer.append(createQuizCard(quiz));
    });
}

/**
 * Loads quizzes from storage and renders them.
 */
export async function loadQuizzes() {
    try {
        const quizzes = await getAllQuizzes();
        renderQuizzesList(quizzes);
    } catch (err) {
        console.error('StudyLens could not load quizzes.', err);
    }
}

/**
 * Initializes the Quizzes page event listeners and initial load.
 */
export function initQuizPage() {
    // Navigation to library from empty state or header button
    document.querySelectorAll('[data-quizzes-go-library]').forEach((btn) => {
        btn.addEventListener('click', () => {
            window.location.hash = '#library';
        });
    });

    // Reactive reload on storage events
    onQuizzesChanged(() => {
        void loadQuizzes();
    });

    onResourcesChanged(() => {
        void loadQuizzes();
    });

    onQuizAttemptsChanged(() => {
        void loadQuizzes();
    });

    // Reload when navigating to the quizzes page
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#quizzes') {
            void loadQuizzes();
        }
    });

    // Initial load
    void loadQuizzes();
}
