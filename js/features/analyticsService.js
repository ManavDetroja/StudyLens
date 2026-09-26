/**
 * Quiz Analytics Service — Day 14.
 *
 * Derives aggregate study performance metrics from stored quiz attempts:
 * - Total quiz attempts
 * - Total unique quizzes taken
 * - Average score (percentage)
 * - Highest score (percentage)
 * - Recent activity list
 *
 * Source of truth is IndexedDB quiz attempts; calculations are purely derived.
 */

import { getAllAttempts } from './quizAttemptService.js';

/**
 * Pure function to calculate analytics metrics from an array of attempt records.
 *
 * @param {Array<object>} [attempts] — array of completed QuizAttempt records
 * @param {object} [options]
 * @param {number} [options.recentLimit=10]
 * @returns {object} derived analytics metrics
 */
export function computeQuizAnalytics(attempts = [], options = {}) {
    const recentLimit = options.recentLimit ?? 10;

    if (!Array.isArray(attempts) || attempts.length === 0) {
        return {
            totalAttempts: 0,
            totalQuizzesTaken: 0,
            uniqueQuizzesCount: 0,
            averageScore: 0,
            averageScorePercentage: 0,
            highestScore: 0,
            highestScorePercentage: 0,
            recentActivity: [],
            recentAttempts: [],
        };
    }

    const totalAttempts = attempts.length;
    const uniqueQuizzes = new Set(attempts.map((a) => a.quizId).filter(Boolean));
    const totalQuizzesTaken = uniqueQuizzes.size;

    const scores = attempts.map((a) => (typeof a.percentage === 'number' ? a.percentage : 0));
    const sumPercentage = scores.reduce((sum, val) => sum + val, 0);
    const averageScore = Math.round(sumPercentage / totalAttempts);
    const highestScore = Math.max(...scores);

    // Recent activity: top N newest attempts
    const recentActivity = [...attempts]
        .sort((a, b) => {
            const timeA = Date.parse(a.completedAt || a.createdAt || 0);
            const timeB = Date.parse(b.completedAt || b.createdAt || 0);
            return timeB - timeA;
        })
        .slice(0, recentLimit);

    return {
        totalAttempts,
        totalQuizzesTaken,
        uniqueQuizzesCount: totalQuizzesTaken,
        averageScore,
        averageScorePercentage: averageScore,
        highestScore,
        highestScorePercentage: highestScore,
        recentActivity,
        recentAttempts: recentActivity,
    };
}

/**
 * Retrieves all stored quiz attempts and computes active analytics.
 *
 * @param {object} [options]
 * @returns {Promise<object>} computed analytics
 */
export async function getQuizAnalytics(options = {}) {
    const attempts = await getAllAttempts(options);
    return computeQuizAnalytics(attempts, options);
}
