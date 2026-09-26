/**
 * Quiz Analytics Page Feature Module — Day 14.
 *
 * Manages the Analytics view (#analytics):
 * - Renders summary statistics: total attempts, unique quizzes taken, average score %, highest score %
 * - Displays chronological recent activity list with score badges and performance breakdown
 * - Honest empty state when no attempts have been recorded yet
 * - Reactive auto-refresh when quiz attempts change, resources are deleted, or quizzes are updated
 * - Direct "Retake" action for recent quizzes
 */

import { getQuizAnalytics } from './analyticsService.js';
import { getQuiz } from './quizService.js';
import { openQuizPlayer, formatAttemptDate } from './quizPlayer.js';
import { onQuizAttemptsChanged, onQuizzesChanged, onResourcesChanged } from '../core/resourceEvents.js';

/**
 * Creates an activity item DOM element for a single attempt.
 *
 * @param {object} item — QuizAttempt summary record
 * @returns {HTMLElement}
 */
export function createActivityItem(item) {
    const card = document.createElement('article');
    card.className = 'analytics-activity-item';
    card.dataset.attemptId = item.id;
    card.dataset.quizId = item.quizId;

    const info = document.createElement('div');
    info.className = 'analytics-activity-info';

    const title = document.createElement('h3');
    title.className = 'analytics-activity-title';
    title.textContent = item.quizTitle || 'Quiz Attempt';

    const meta = document.createElement('div');
    meta.className = 'analytics-activity-meta';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'analytics-activity-date';
    dateSpan.textContent = formatAttemptDate(item.completedAt || item.createdAt);

    const breakdownSpan = document.createElement('span');
    breakdownSpan.className = 'analytics-activity-counts';
    const counts = [`${item.correctCount} correct`, `${item.incorrectCount} incorrect`];
    if (item.unansweredCount > 0) {
        counts.push(`${item.unansweredCount} unanswered`);
    }
    breakdownSpan.textContent = ` • ${counts.join(', ')}`;

    meta.append(dateSpan, breakdownSpan);
    info.append(title, meta);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'analytics-activity-right';

    const scoreBadge = document.createElement('span');
    let badgeClass = 'badge';
    if (item.percentage >= 80) {
        badgeClass += ' quiz-badge-correct';
    } else if (item.percentage >= 50) {
        badgeClass += ' badge-accent';
    } else {
        badgeClass += ' quiz-badge-incorrect';
    }
    scoreBadge.className = badgeClass;
    scoreBadge.textContent = `${item.score} / ${item.totalQuestions} (${item.percentage}%)`;

    const retakeBtn = document.createElement('button');
    retakeBtn.className = 'button button-secondary button-small';
    retakeBtn.type = 'button';
    retakeBtn.textContent = 'Retake';
    retakeBtn.addEventListener('click', async () => {
        try {
            const quiz = await getQuiz(item.quizId);
            if (quiz) {
                openQuizPlayer(quiz);
            } else {
                window.location.hash = '#quizzes';
            }
        } catch {
            window.location.hash = '#quizzes';
        }
    });

    rightGroup.append(scoreBadge, retakeBtn);
    card.append(info, rightGroup);

    return card;
}

/**
 * Renders aggregate analytics and activity list into the DOM.
 *
 * @param {object} analytics — aggregate metrics
 */
export function renderAnalytics(analytics) {
    const emptyEl = document.querySelector('[data-analytics-empty]');
    const contentEl = document.querySelector('[data-analytics-content]');
    const totalAttemptsEl = document.querySelector('[data-analytics-total-attempts]');
    const quizzesTakenEl = document.querySelector('[data-analytics-quizzes-taken]');
    const avgScoreEl = document.querySelector('[data-analytics-average-score]');
    const highestScoreEl = document.querySelector('[data-analytics-highest-score]');
    const activityList = document.querySelector('[data-analytics-activity-list]');

    if (!emptyEl || !contentEl) return;

    if (!analytics || analytics.totalAttempts === 0) {
        emptyEl.hidden = false;
        contentEl.hidden = true;
        if (activityList) activityList.replaceChildren();
        return;
    }

    emptyEl.hidden = true;
    contentEl.hidden = false;

    if (totalAttemptsEl) totalAttemptsEl.textContent = String(analytics.totalAttempts);
    if (quizzesTakenEl) quizzesTakenEl.textContent = String(analytics.uniqueQuizzesCount);
    if (avgScoreEl) avgScoreEl.textContent = `${analytics.averageScorePercentage}%`;
    if (highestScoreEl) highestScoreEl.textContent = `${analytics.highestScorePercentage}%`;

    if (activityList) {
        activityList.replaceChildren();
        const recent = Array.isArray(analytics.recentAttempts) ? analytics.recentAttempts : [];
        recent.forEach((attempt) => {
            activityList.append(createActivityItem(attempt));
        });
    }
}

/**
 * Loads analytics from storage and renders the view.
 */
export async function loadAnalytics() {
    try {
        const analytics = await getQuizAnalytics();
        renderAnalytics(analytics);
    } catch (err) {
        console.error('StudyLens could not load quiz analytics.', err);
    }
}

/**
 * Initializes the Analytics page controller and reactive listeners.
 */
export function initAnalyticsPage() {
    // Navigation from empty state button
    document.querySelector('[data-analytics-go-quizzes]')?.addEventListener('click', () => {
        window.location.hash = '#quizzes';
    });

    // Reactive refresh when storage events occur
    onQuizAttemptsChanged(() => {
        void loadAnalytics();
    });

    onQuizzesChanged(() => {
        void loadAnalytics();
    });

    onResourcesChanged(() => {
        void loadAnalytics();
    });

    // Reload when navigating to the analytics page
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#analytics') {
            void loadAnalytics();
        }
    });

    // Initial load
    void loadAnalytics();
}
