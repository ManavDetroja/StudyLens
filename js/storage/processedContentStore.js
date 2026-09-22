/**
 * Persistent storage for processed resource content — Day 8.
 *
 * Each ProcessedContent record is keyed by a generated UUID and indexed
 * by resourceId (unique). This ensures one processed result per resource.
 *
 * Data flow:
 *   Feature logic → ProcessedContentRepository → IndexedDB processedContent store
 */

import { PROCESSED_CONTENT_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: 'REQUEST_FAILED',
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

export class ProcessedContentRepository {
    constructor({
        database = studyLensDatabase,
        idGenerator = () => (typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : 'processed-' + Math.random().toString(36).slice(2)),
        clock = () => new Date(),
    } = {}) {
        this.database = database;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    /**
     * Save processed content. Replaces any existing record for the same resourceId.
     * @param {object} processedContent — NormalizedContent with segments
     * @returns {Promise<object>} — the saved record
     */
    async saveProcessedContent(processedContent) {
        if (!processedContent || !processedContent.resourceId) {
            throw new StorageError('Processed content must include a resourceId.', {
                code: 'INVALID_PROCESSED_CONTENT',
            });
        }

        const now = this.clock();
        const timestamp = now instanceof Date ? now.toISOString() : now;

        const record = {
            id: processedContent.id ?? this.idGenerator(),
            resourceId: processedContent.resourceId,
            normalizedText: processedContent.text ?? '',
            chunks: processedContent.segments ?? [],
            sourceType: processedContent.sourceType ?? 'text',
            metadata: processedContent.metadata ?? {},
            createdAt: processedContent.createdAt ?? timestamp,
            updatedAt: timestamp,
        };

        await this.withStore('readwrite', 'save processed content', async (store) => {
            /* Remove any existing record for this resourceId first */
            const index = store.index('resourceId');
            const existing = await requestToPromise(
                index.getKey(record.resourceId),
                'look up existing processed content',
            );
            if (existing) {
                await requestToPromise(store.delete(existing), 'remove stale processed content');
            }
            await requestToPromise(store.add(record), 'save processed content');
        });

        return record;
    }

    /**
     * Get processed content for a specific resource.
     * @param {string} resourceId
     * @returns {Promise<object|null>}
     */
    async getByResourceId(resourceId) {
        if (typeof resourceId !== 'string' || resourceId.trim() === '') {
            throw new StorageError('A resource id is required.', { code: 'INVALID_RESOURCE_ID' });
        }

        return this.withStore('readonly', 'read processed content', async (store) => {
            const index = store.index('resourceId');
            const result = await requestToPromise(
                index.get(resourceId),
                'read processed content',
            );
            return result ?? null;
        });
    }

    /**
     * Delete processed content for a specific resource.
     * @param {string} resourceId
     * @returns {Promise<boolean>}
     */
    async deleteByResourceId(resourceId) {
        if (typeof resourceId !== 'string' || resourceId.trim() === '') {
            throw new StorageError('A resource id is required.', { code: 'INVALID_RESOURCE_ID' });
        }

        return this.withStore('readwrite', 'delete processed content', async (store) => {
            const index = store.index('resourceId');
            const key = await requestToPromise(
                index.getKey(resourceId),
                'look up processed content for deletion',
            );
            if (!key) return false;
            await requestToPromise(store.delete(key), 'delete processed content');
            return true;
        });
    }

    async countProcessedContent() {
        return this.withStore('readonly', 'count processed content', (store) => {
            return requestToPromise(store.count(), 'count processed content');
        });
    }

    async clearProcessedContent() {
        return this.withStore('readwrite', 'clear processed content', async (store) => {
            const count = await requestToPromise(store.count(), 'count processed content');
            await requestToPromise(store.clear(), 'clear processed content');
            return count;
        });
    }

    async withStore(mode, operation, callback) {
        const database = await this.database.open();

        if (!database.objectStoreNames.contains(PROCESSED_CONTENT_STORE)) {
            throw new StorageError('StudyLens processed content storage is unavailable.', {
                code: 'OBJECT_STORE_MISSING',
            });
        }

        let transaction;

        try {
            transaction = database.transaction(PROCESSED_CONTENT_STORE, mode);
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not start a storage transaction.', 'TRANSACTION_OPEN_FAILED');
        }

        const completion = transactionToPromise(transaction, operation);

        try {
            const result = await callback(transaction.objectStore(PROCESSED_CONTENT_STORE));
            await completion;
            return result;
        } catch (error) {
            try { transaction.abort(); } catch { /* already completed/aborted */ }
            await completion.catch(() => undefined);
            throw asStorageError(error, 'StudyLens could not ' + operation + '.', 'STORAGE_OPERATION_FAILED');
        }
    }
}

export const processedContentRepository = new ProcessedContentRepository();
