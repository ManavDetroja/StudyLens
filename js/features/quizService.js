/**
 * Quiz Orchestration Service — Day 13.
 *
 * Coordinates quiz generation, persistence, retrieval, and cleanup:
 * 1. Retrieves resource and existing learning outputs (auto-generates if absent).
 * 2. Runs deterministic MCQ generation via quizGenerator.
 * 3. Removes previous quizzes for this resource to ensure duplicate safety on regeneration.
 * 4. Persists the validated Quiz record to IndexedDB via QuizRepository.
 * 5. Dispatches quizzes-changed notification events.
 */

import { generateQuiz } from '../processing/quizGenerator.js';
import { quizRepository } from '../storage/quizStore.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { learningOutputRepository } from '../storage/learningOutputStore.js';
import { notifyQuizzesChanged } from '../core/resourceEvents.js';
import { generateLearningOutputsForResource } from './learningOutputService.js';

/**
 * Generate, replace, and persist a quiz for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @param {object} [options.quizRepo]
 * @param {object} [options.learningRepo]
 * @param {object} [options.resRepo]
 * @param {object} [options.processedRepo]
 * @returns {Promise<{ resourceId: string, quiz: object, questionCount: number }>}
 */
export async function generateQuizForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new Error('A valid resourceId is required to generate a quiz.');
    }

    const quizRepo = options.quizRepo ?? quizRepository;
    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const resRepo = options.resRepo ?? resourceRepository;

    // 1. Verify resource exists
    const resource = await resRepo.getResource(resourceId);
    if (!resource) {
        throw new Error('Resource not found: ' + resourceId);
    }

    // 2. Retrieve existing learning outputs (or auto-generate if missing)
    let allOutputs = await learningRepo.getLearningOutputsByResourceId(resourceId);
    const nonFlashcardOutputs = allOutputs.filter((o) => o.type !== 'flashcard');

    if (nonFlashcardOutputs.length === 0) {
        try {
            await generateLearningOutputsForResource(resourceId, {
                resRepo,
                learningRepo,
                processedRepo: options.processedRepo,
            });
            allOutputs = await learningRepo.getLearningOutputsByResourceId(resourceId);
        } catch {
            // Auto-generation attempt made
        }
    }

    const sourceOutputs = allOutputs.filter((o) => o.type !== 'flashcard');

    if (sourceOutputs.length === 0) {
        throw new Error('No learning content available to generate a quiz from.');
    }

    // 3. Generate deterministic quiz
    const quizRecord = generateQuiz(sourceOutputs, resource, options);

    // 4. Remove previous quizzes for this resource (regeneration duplicate safety)
    await quizRepo.deleteQuizzesByResourceId(resourceId);

    // 5. Persist the new quiz
    const savedQuiz = await quizRepo.createQuiz(quizRecord);

    // 6. Notify UI / event listeners
    notifyQuizzesChanged({
        action: 'generated',
        resourceId,
        quizId: savedQuiz.id,
        questionCount: savedQuiz.questions.length,
    });

    return {
        resourceId,
        quiz: savedQuiz,
        questionCount: savedQuiz.questions.length,
    };
}

/**
 * Retrieve the active quiz for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function getQuizForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return null;
    }

    const quizRepo = options.quizRepo ?? quizRepository;
    const quizzes = await quizRepo.getQuizzesByResourceId(resourceId);
    return quizzes.length > 0 ? quizzes[0] : null;
}

/**
 * Retrieve a quiz by its unique ID.
 *
 * @param {string} quizId
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function getQuiz(quizId, options = {}) {
    if (typeof quizId !== 'string' || quizId.trim() === '') {
        return null;
    }

    const quizRepo = options.quizRepo ?? quizRepository;
    return quizRepo.getQuiz(quizId);
}

/**
 * Retrieve all quizzes in storage.
 *
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getAllQuizzes(options = {}) {
    const quizRepo = options.quizRepo ?? quizRepository;
    return quizRepo.getAllQuizzes();
}

/**
 * Delete a quiz by its unique ID.
 *
 * @param {string} quizId
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function deleteQuiz(quizId, options = {}) {
    if (typeof quizId !== 'string' || quizId.trim() === '') {
        return false;
    }

    const quizRepo = options.quizRepo ?? quizRepository;
    const deleted = await quizRepo.deleteQuiz(quizId);

    if (deleted) {
        notifyQuizzesChanged({
            action: 'deleted',
            quizId,
        });
    }

    return deleted;
}

/**
 * Delete all quizzes for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function deleteQuizzesForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return 0;
    }

    const quizRepo = options.quizRepo ?? quizRepository;
    const count = await quizRepo.deleteQuizzesByResourceId(resourceId);

    if (count > 0) {
        notifyQuizzesChanged({
            action: 'deleted',
            resourceId,
            count,
        });
    }

    return count;
}

/**
 * Get total count of quizzes in storage.
 *
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function countQuizzes(options = {}) {
    const quizRepo = options.quizRepo ?? quizRepository;
    return quizRepo.countQuizzes();
}
