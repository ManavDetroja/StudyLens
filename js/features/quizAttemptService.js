/**
 * Quiz Attempt Service — Day 14.
 *
 * Coordinates quiz attempt lifecycle:
 * - Calculates scores and answers against quiz definitions
 * - Persists completed attempts in IndexedDB via QuizAttemptRepository
 * - Ensures multiple attempts for the same quiz are stored without overwriting
 * - Provides historical queries by quiz, by resource, or global
 * - Coordinates cascading cleanup when resources or quizzes are removed
 * - Dispatches reactive events (quizattemptschanged)
 */

import { quizAttemptRepository } from '../storage/quizAttemptStore.js';
import { calculateQuizResult } from '../processing/quizScoreCalculator.js';
import { notifyQuizAttemptsChanged } from '../core/resourceEvents.js';

/**
 * Evaluates and records a completed quiz attempt into storage.
 *
 * @param {object} quiz — Quiz definition record
 * @param {Map<string, string>|Record<string, string>} userAnswers — user's answer selections
 * @param {object} [options]
 * @param {string} [options.startedAt] — ISO timestamp when session began
 * @param {string} [options.completedAt] — ISO timestamp when session completed
 * @param {object} [options.metadata]
 * @param {object} [options.attemptRepo]
 * @returns {Promise<object>} stored QuizAttempt record
 */
export async function recordQuizAttempt(quiz, userAnswers = {}, options = {}) {
    if (!quiz || typeof quiz.id !== 'string' || typeof quiz.resourceId !== 'string') {
        throw new Error('A valid quiz with id and resourceId is required to record an attempt.');
    }

    const repo = options.attemptRepo ?? quizAttemptRepository;
    const now = new Date().toISOString();
    const startedAt = options.startedAt || now;
    const completedAt = options.completedAt || now;

    // 1. Calculate deterministic score and question breakdown
    const result = calculateQuizResult(quiz, userAnswers);

    // 2. Build attempt input preserving quiz title and resource link
    const attemptInput = {
        quizId: quiz.id,
        resourceId: quiz.resourceId,
        quizTitle: quiz.title || 'Study Quiz',
        score: result.score,
        correctCount: result.correctCount,
        incorrectCount: result.incorrectCount,
        unansweredCount: result.unansweredCount,
        totalQuestions: result.totalQuestions,
        percentage: result.percentage,
        answers: result.answers,
        questionResults: result.questionResults,
        startedAt,
        completedAt,
        metadata: options.metadata ?? {},
    };

    // 3. Persist as an independent historical record (never overwrites previous attempts)
    const savedAttempt = await repo.createQuizAttempt(attemptInput);

    // 4. Notify reactive listeners
    notifyQuizAttemptsChanged({
        action: 'created',
        attemptId: savedAttempt.id,
        quizId: savedAttempt.quizId,
        resourceId: savedAttempt.resourceId,
        score: savedAttempt.score,
        totalQuestions: savedAttempt.totalQuestions,
        percentage: savedAttempt.percentage,
    });

    return savedAttempt;
}

/**
 * Retrieve a specific attempt by ID.
 *
 * @param {string} attemptId
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function getAttempt(attemptId, options = {}) {
    if (typeof attemptId !== 'string' || attemptId.trim() === '') {
        return null;
    }
    const repo = options.attemptRepo ?? quizAttemptRepository;
    return repo.getQuizAttempt(attemptId);
}

/**
 * Retrieve all historical attempts for a specific quiz, ordered newest first.
 *
 * @param {string} quizId
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getAttemptsForQuiz(quizId, options = {}) {
    if (typeof quizId !== 'string' || quizId.trim() === '') {
        return [];
    }
    const repo = options.attemptRepo ?? quizAttemptRepository;
    return repo.getAttemptsByQuiz(quizId);
}

/**
 * Retrieve all historical attempts for a specific resource, ordered newest first.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getAttemptsForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return [];
    }
    const repo = options.attemptRepo ?? quizAttemptRepository;
    return repo.getAttemptsByResource(resourceId);
}

/**
 * Retrieve all attempts across the application, ordered newest first.
 *
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getAllAttempts(options = {}) {
    const repo = options.attemptRepo ?? quizAttemptRepository;
    return repo.getAllAttempts();
}

/**
 * Delete a specific attempt by ID.
 *
 * @param {string} attemptId
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function deleteAttempt(attemptId, options = {}) {
    if (typeof attemptId !== 'string' || attemptId.trim() === '') {
        return false;
    }
    const repo = options.attemptRepo ?? quizAttemptRepository;
    const deleted = await repo.deleteQuizAttempt(attemptId);
    if (deleted) {
        notifyQuizAttemptsChanged({ action: 'deleted', attemptId });
    }
    return deleted;
}

/**
 * Delete all attempts for a specific quiz.
 *
 * @param {string} quizId
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function deleteAttemptsForQuiz(quizId, options = {}) {
    if (typeof quizId !== 'string' || quizId.trim() === '') {
        return 0;
    }
    const repo = options.attemptRepo ?? quizAttemptRepository;
    const count = await repo.deleteAttemptsByQuiz(quizId);
    if (count > 0) {
        notifyQuizAttemptsChanged({ action: 'deleted_by_quiz', quizId, count });
    }
    return count;
}

/**
 * Delete all attempts associated with a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function deleteAttemptsForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return 0;
    }
    const repo = options.attemptRepo ?? quizAttemptRepository;
    const count = await repo.deleteAttemptsByResource(resourceId);
    if (count > 0) {
        notifyQuizAttemptsChanged({ action: 'deleted_by_resource', resourceId, count });
    }
    return count;
}

/**
 * Count total completed attempts in storage.
 *
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function countAttempts(options = {}) {
    const repo = options.attemptRepo ?? quizAttemptRepository;
    return repo.countAttempts();
}
