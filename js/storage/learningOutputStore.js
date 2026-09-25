/**
 * Persistent storage repository for Learning Outputs — Day 9.
 *
 * Implements the storage layer for structured learning outputs (summaries,
 * notes, concepts, definitions, questions, flashcards, quizzes) with
 * indexes for resourceId, type, and createdAt.
 */

import { LEARNING_OUTPUT_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';
import {
    LEARNING_OUTPUT_TYPES,
    createLearningOutputRecord,
    createUpdatedLearningOutput,
    generateLearningOutputId,
} from './learningOutputValidation.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_LEARNING_OUTPUT_ID' : 'REQUEST_FAILED',
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

function validateOutputId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new StorageError('A learning output id is required.', { code: 'INVALID_OUTPUT_ID' });
    }
}

function validateResourceId(resourceId) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new StorageError('A resource id is required.', { code: 'INVALID_RESOURCE_ID' });
    }
}

export function sortByCreatedAt(outputs, direction = 'descending') {
    const multiplier = direction === 'ascending' ? 1 : -1;

    return [...outputs].sort((first, second) => {
        return (Date.parse(first.createdAt) - Date.parse(second.createdAt)) * multiplier;
    });
}

export class LearningOutputRepository {
    constructor({
        database = studyLensDatabase,
        idGenerator = generateLearningOutputId,
        clock = () => new Date(),
    } = {}) {
        this.database = database;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    /**
     * Create and store a new learning output.
     *
     * @param {object} input
     * @returns {Promise<object>} created record
     */
    async createLearningOutput(input) {
        const record = createLearningOutputRecord(input, {
            idGenerator: this.idGenerator,
            clock: this.clock,
        });

        await this.withStore('readwrite', 'create the learning output', async (store) => {
            await requestToPromise(store.add(record), 'create the learning output');
        });

        return record;
    }

    /**
     * Retrieve a learning output by its unique ID.
     *
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getLearningOutput(id) {
        validateOutputId(id);

        return this.withStore('readonly', 'read the learning output', (store) => {
            return requestToPromise(store.get(id), 'read the learning output');
        }).then((output) => output ?? null);
    }

    /**
     * Retrieve all learning outputs associated with a specific resource ID.
     *
     * @param {string} resourceId
     * @returns {Promise<object[]>}
     */
    async getLearningOutputsByResourceId(resourceId) {
        validateResourceId(resourceId);

        const outputs = await this.withStore('readonly', 'read learning outputs by resource', (store) => {
            return requestToPromise(store.index('resourceId').getAll(resourceId), 'read learning outputs by resource');
        });

        return sortByCreatedAt(outputs, 'ascending');
    }

    /**
     * Retrieve all learning outputs of a specific type across resources.
     *
     * @param {string} type
     * @returns {Promise<object[]>}
     */
    async getLearningOutputsByType(type) {
        if (!LEARNING_OUTPUT_TYPES.includes(type)) {
            throw new StorageError('Unsupported learning output type: ' + type + '.', {
                code: 'INVALID_OUTPUT_TYPE',
            });
        }

        const outputs = await this.withStore('readonly', 'read learning outputs by type', (store) => {
            return requestToPromise(store.index('type').getAll(type), 'read learning outputs by type');
        });

        return sortByCreatedAt(outputs, 'descending');
    }

    /**
     * Retrieve all learning outputs.
     *
     * @returns {Promise<object[]>}
     */
    async getAllLearningOutputs() {
        const outputs = await this.withStore('readonly', 'read all learning outputs', (store) => {
            return requestToPromise(store.getAll(), 'read all learning outputs');
        });

        return sortByCreatedAt(outputs, 'descending');
    }

    /**
     * Update an existing learning output.
     *
     * @param {string} id
     * @param {object} updates
     * @returns {Promise<object>} updated record
     */
    async updateLearningOutput(id, updates) {
        validateOutputId(id);

        return this.withStore('readwrite', 'update the learning output', async (store) => {
            const existing = await requestToPromise(store.get(id), 'read the learning output for updating');
            if (!existing) {
                throw new StorageError('The requested learning output does not exist.', {
                    code: 'LEARNING_OUTPUT_NOT_FOUND',
                });
            }

            const updated = createUpdatedLearningOutput(existing, updates, {
                clock: this.clock,
            });
            await requestToPromise(store.put(updated), 'update the learning output');
            return updated;
        });
    }

    /**
     * Delete a single learning output by ID.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteLearningOutput(id) {
        validateOutputId(id);

        return this.withStore('readwrite', 'delete the learning output', async (store) => {
            const existing = await requestToPromise(store.get(id), 'read the learning output for deleting');
            if (!existing) return false;

            await requestToPromise(store.delete(id), 'delete the learning output');
            return true;
        });
    }

    /**
     * Delete all learning outputs associated with a specific resource ID.
     * Used for cascade cleanup when a resource is deleted.
     *
     * @param {string} resourceId
     * @returns {Promise<number>} number of deleted records
     */
    async deleteLearningOutputsByResourceId(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readwrite', 'delete learning outputs for resource', async (store) => {
            const keys = await requestToPromise(
                store.index('resourceId').getAllKeys(resourceId),
                'lookup learning output keys by resourceId',
            );

            let deletedCount = 0;
            for (const key of keys) {
                await requestToPromise(store.delete(key), 'delete learning output record');
                deletedCount += 1;
            }

            return deletedCount;
        });
    }

    /**
     * Clear all learning outputs from storage.
     *
     * @returns {Promise<number>} count of cleared records
     */
    async clearLearningOutputs() {
        return this.withStore('readwrite', 'clear learning outputs', async (store) => {
            const count = await requestToPromise(store.count(), 'count learning outputs');
            await requestToPromise(store.clear(), 'clear learning outputs');
            return count;
        });
    }

    /**
     * Count total learning outputs in storage.
     *
     * @returns {Promise<number>}
     */
    async countLearningOutputs() {
        return this.withStore('readonly', 'count learning outputs', (store) => {
            return requestToPromise(store.count(), 'count learning outputs');
        });
    }

    async withStore(mode, operation, callback) {
        const database = await this.database.open();

        if (!database.objectStoreNames.contains(LEARNING_OUTPUT_STORE)) {
            throw new StorageError('StudyLens learning outputs storage is unavailable.', {
                code: 'OBJECT_STORE_MISSING',
            });
        }

        let transaction;

        try {
            transaction = database.transaction(LEARNING_OUTPUT_STORE, mode);
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not start a storage transaction.', 'TRANSACTION_OPEN_FAILED');
        }

        const completion = transactionToPromise(transaction, operation);

        try {
            const result = await callback(transaction.objectStore(LEARNING_OUTPUT_STORE));
            await completion;
            return result;
        } catch (error) {
            try {
                transaction.abort();
            } catch {
                // The transaction may already have completed or aborted.
            }

            await completion.catch(() => undefined);
            throw asStorageError(error, 'StudyLens could not ' + operation + '.', 'STORAGE_OPERATION_FAILED');
        }
    }
}

export const learningOutputRepository = new LearningOutputRepository();
