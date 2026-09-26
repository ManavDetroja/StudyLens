/**
 * Persistent storage repository for Quizzes — Day 13.
 *
 * Implements the storage layer for structured quizzes with
 * indexes for resourceId and createdAt.
 */

import { QUIZ_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';
import {
    createQuizRecord,
    createUpdatedQuiz,
    generateQuizId,
    validateQuiz,
} from './quizValidation.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_QUIZ_ID' : 'REQUEST_FAILED',
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

function validateQuizId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new StorageError('A quiz id is required.', { code: 'INVALID_QUIZ_ID' });
    }
}

function validateResourceId(resourceId) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new StorageError('A resource id is required.', { code: 'INVALID_RESOURCE_ID' });
    }
}

export function sortByCreatedAt(quizzes, direction = 'descending') {
    const multiplier = direction === 'ascending' ? 1 : -1;

    return [...quizzes].sort((first, second) => {
        return (Date.parse(first.createdAt) - Date.parse(second.createdAt)) * multiplier;
    });
}

export class QuizRepository {
    constructor({
        database = studyLensDatabase,
        idGenerator = generateQuizId,
        clock = () => new Date(),
    } = {}) {
        this.database = database;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    /**
     * Create and store a new Quiz.
     *
     * @param {object} input
     * @returns {Promise<object>} stored quiz record
     */
    async createQuiz(input) {
        const record = createQuizRecord(input, {
            idGenerator: this.idGenerator,
            clock: this.clock,
        });

        return this.withStore('readwrite', 'save the quiz', async (store) => {
            await requestToPromise(store.add(record), 'save the quiz');
            return record;
        });
    }

    /**
     * Retrieve a Quiz by id.
     *
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getQuiz(id) {
        validateQuizId(id);

        return this.withStore('readonly', 'load the quiz', async (store) => {
            const result = await requestToPromise(store.get(id), 'load the quiz');
            return result ? validateQuiz(result) : null;
        });
    }

    /**
     * Retrieve all Quizzes associated with a specific resource.
     *
     * @param {string} resourceId
     * @returns {Promise<Array<object>>}
     */
    async getQuizzesByResourceId(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readonly', 'load quizzes for this resource', async (store) => {
            const index = store.index('resourceId');
            const result = await requestToPromise(index.getAll(resourceId), 'load quizzes for this resource');
            return sortByCreatedAt(result.map(validateQuiz));
        });
    }

    /**
     * Retrieve all Quizzes in storage.
     *
     * @returns {Promise<Array<object>>}
     */
    async getAllQuizzes() {
        return this.withStore('readonly', 'load all quizzes', async (store) => {
            const result = await requestToPromise(store.getAll(), 'load all quizzes');
            return sortByCreatedAt(result.map(validateQuiz));
        });
    }

    /**
     * Update an existing Quiz.
     *
     * @param {string} id
     * @param {object} updates
     * @returns {Promise<object>}
     */
    async updateQuiz(id, updates) {
        validateQuizId(id);

        return this.withStore('readwrite', 'update the quiz', async (store) => {
            const existing = await requestToPromise(store.get(id), 'load the quiz for update');
            if (!existing) {
                throw new StorageError('Quiz not found: ' + id, { code: 'QUIZ_NOT_FOUND' });
            }

            const updatedRecord = createUpdatedQuiz(existing, updates, { clock: this.clock });
            await requestToPromise(store.put(updatedRecord), 'update the quiz');
            return updatedRecord;
        });
    }

    /**
     * Delete a Quiz by id.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteQuiz(id) {
        validateQuizId(id);

        return this.withStore('readwrite', 'delete the quiz', async (store) => {
            const existing = await requestToPromise(store.get(id), 'find the quiz before deletion');
            if (!existing) return false;

            await requestToPromise(store.delete(id), 'delete the quiz');
            return true;
        });
    }

    /**
     * Delete all Quizzes associated with a specific resource.
     *
     * @param {string} resourceId
     * @returns {Promise<number>} count of deleted quizzes
     */
    async deleteQuizzesByResourceId(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readwrite', 'delete quizzes for this resource', async (store) => {
            const index = store.index('resourceId');
            const quizzes = await requestToPromise(index.getAll(resourceId), 'find quizzes to delete');

            for (const quiz of quizzes) {
                await requestToPromise(store.delete(quiz.id), 'delete quiz ' + quiz.id);
            }

            return quizzes.length;
        });
    }

    /**
     * Count total quizzes in storage.
     *
     * @returns {Promise<number>}
     */
    async countQuizzes() {
        return this.withStore('readonly', 'count quizzes', (store) => {
            return requestToPromise(store.count(), 'count quizzes');
        });
    }

    /**
     * Clear all quizzes from storage.
     *
     * @returns {Promise<number>}
     */
    async clearQuizzes() {
        return this.withStore('readwrite', 'clear quizzes', async (store) => {
            const count = await requestToPromise(store.count(), 'count quizzes before clear');
            await requestToPromise(store.clear(), 'clear quizzes');
            return count;
        });
    }

    async withStore(mode, operation, callback) {
        const database = await this.database.open();

        if (!database.objectStoreNames.contains(QUIZ_STORE)) {
            throw new StorageError('StudyLens quizzes storage is unavailable.', {
                code: 'OBJECT_STORE_MISSING',
            });
        }

        let transaction;

        try {
            transaction = database.transaction(QUIZ_STORE, mode);
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not start a storage transaction.', 'TRANSACTION_OPEN_FAILED');
        }

        const completion = transactionToPromise(transaction, operation);

        try {
            const result = await callback(transaction.objectStore(QUIZ_STORE));
            await completion;
            return result;
        } catch (error) {
            try {
                transaction.abort();
            } catch {
                // Transaction may have completed or aborted.
            }

            await completion.catch(() => undefined);
            throw asStorageError(error, 'StudyLens could not ' + operation + '.', 'STORAGE_OPERATION_FAILED');
        }
    }
}

export const quizRepository = new QuizRepository();
