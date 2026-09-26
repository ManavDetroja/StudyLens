/**
 * Persistent storage repository for Quiz Attempts — Day 14.
 *
 * Implements the storage layer for completed quiz attempts with
 * indexes for quizId, resourceId, completedAt, and createdAt.
 */

import { QUIZ_ATTEMPT_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';
import {
    createQuizAttemptRecord,
    generateQuizAttemptId,
    validateQuizAttempt,
} from './quizAttemptValidation.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_ATTEMPT_ID' : 'REQUEST_FAILED',
                cause: request.error,
            }));
        });
    });
}

function transactionToPromise(transaction, operation) {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve());
        transaction.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: 'TRANSACTION_FAILED',
                cause: transaction.error,
            }));
        });
        transaction.addEventListener('abort', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: 'TRANSACTION_ABORTED',
                cause: transaction.error,
            }));
        });
    });
}

function validateAttemptId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new StorageError('A quiz attempt id is required.', { code: 'INVALID_ATTEMPT_ID' });
    }
}

function validateQuizId(quizId) {
    if (typeof quizId !== 'string' || quizId.trim() === '') {
        throw new StorageError('A quiz id is required.', { code: 'INVALID_QUIZ_ID' });
    }
}

function validateResourceId(resourceId) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new StorageError('A resource id is required.', { code: 'INVALID_RESOURCE_ID' });
    }
}

export function sortByCompletedAt(attempts, direction = 'descending') {
    const multiplier = direction === 'ascending' ? 1 : -1;

    return [...attempts].sort((first, second) => {
        const timeA = Date.parse(first.completedAt || first.createdAt || 0);
        const timeB = Date.parse(second.completedAt || second.createdAt || 0);
        return (timeA - timeB) * multiplier;
    });
}

export class QuizAttemptRepository {
    constructor({
        database = studyLensDatabase,
        idGenerator = generateQuizAttemptId,
        clock = () => new Date(),
    } = {}) {
        this.database = database;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    /**
     * Create and store a new Quiz Attempt.
     *
     * @param {object} input
     * @returns {Promise<object>} stored attempt record
     */
    async createQuizAttempt(input) {
        const record = createQuizAttemptRecord(input, {
            idGenerator: this.idGenerator,
            clock: this.clock,
        });

        return this.withStore('readwrite', 'save the quiz attempt', async (store) => {
            await requestToPromise(store.add(record), 'save the quiz attempt');
            return record;
        });
    }

    /**
     * Retrieve a Quiz Attempt by id.
     *
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getQuizAttempt(id) {
        validateAttemptId(id);

        return this.withStore('readonly', 'load the quiz attempt', async (store) => {
            const result = await requestToPromise(store.get(id), 'load the quiz attempt');
            return result ? validateQuizAttempt(result) : null;
        });
    }

    /**
     * Retrieve all Quiz Attempts for a specific quiz.
     *
     * @param {string} quizId
     * @returns {Promise<Array<object>>}
     */
    async getAttemptsByQuiz(quizId) {
        validateQuizId(quizId);

        return this.withStore('readonly', 'load attempts for this quiz', async (store) => {
            const index = store.index('quizId');
            const result = await requestToPromise(index.getAll(quizId), 'load attempts for this quiz');
            return sortByCompletedAt(result.map(validateQuizAttempt));
        });
    }

    /**
     * Retrieve all Quiz Attempts associated with a specific resource.
     *
     * @param {string} resourceId
     * @returns {Promise<Array<object>>}
     */
    async getAttemptsByResource(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readonly', 'load attempts for this resource', async (store) => {
            const index = store.index('resourceId');
            const result = await requestToPromise(index.getAll(resourceId), 'load attempts for this resource');
            return sortByCompletedAt(result.map(validateQuizAttempt));
        });
    }

    /**
     * Retrieve all Quiz Attempts in storage.
     *
     * @returns {Promise<Array<object>>}
     */
    async getAllAttempts() {
        return this.withStore('readonly', 'load all quiz attempts', async (store) => {
            const result = await requestToPromise(store.getAll(), 'load all quiz attempts');
            return sortByCompletedAt(result.map(validateQuizAttempt));
        });
    }

    /**
     * Delete a single Quiz Attempt by id.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteQuizAttempt(id) {
        validateAttemptId(id);

        return this.withStore('readwrite', 'delete the quiz attempt', async (store) => {
            const existing = await requestToPromise(store.get(id), 'locate the quiz attempt');
            if (!existing) return false;

            await requestToPromise(store.delete(id), 'delete the quiz attempt');
            return true;
        });
    }

    /**
     * Delete all Quiz Attempts for a specific quiz.
     *
     * @param {string} quizId
     * @returns {Promise<number>} count of deleted attempts
     */
    async deleteAttemptsByQuiz(quizId) {
        validateQuizId(quizId);

        return this.withStore('readwrite', 'delete attempts for this quiz', async (store) => {
            const index = store.index('quizId');
            const keys = await requestToPromise(index.getAllKeys(quizId), 'locate attempts for this quiz');

            for (const key of keys) {
                await requestToPromise(store.delete(key), 'delete a quiz attempt');
            }

            return keys.length;
        });
    }

    /**
     * Delete all Quiz Attempts associated with a specific resource.
     *
     * @param {string} resourceId
     * @returns {Promise<number>} count of deleted attempts
     */
    async deleteAttemptsByResource(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readwrite', 'delete attempts for this resource', async (store) => {
            const index = store.index('resourceId');
            const keys = await requestToPromise(index.getAllKeys(resourceId), 'locate attempts for this resource');

            for (const key of keys) {
                await requestToPromise(store.delete(key), 'delete a quiz attempt');
            }

            return keys.length;
        });
    }

    /**
     * Count total Quiz Attempts in storage.
     *
     * @returns {Promise<number>}
     */
    async countAttempts() {
        return this.withStore('readonly', 'count quiz attempts', async (store) => {
            return requestToPromise(store.count(), 'count quiz attempts');
        });
    }

    /**
     * Clear all attempts in storage.
     *
     * @returns {Promise<number>}
     */
    async clearAttempts() {
        return this.withStore('readwrite', 'clear quiz attempts', async (store) => {
            const count = await requestToPromise(store.count(), 'count attempts before clear');
            await requestToPromise(store.clear(), 'clear quiz attempts');
            return count;
        });
    }

    /**
     * Executes an operation inside an IndexedDB transaction.
     *
     * @private
     */
    async withStore(mode, operation, action) {
        try {
            const database = await this.database.open();
            const transaction = database.transaction(QUIZ_ATTEMPT_STORE, mode);
            const store = transaction.objectStore(QUIZ_ATTEMPT_STORE);

            const [result] = await Promise.all([
                action(store),
                transactionToPromise(transaction, operation),
            ]);

            return result;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not ' + operation + '.');
        }
    }
}

export const quizAttemptRepository = new QuizAttemptRepository();
