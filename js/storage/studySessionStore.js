/**
 * Persistent Storage Repository for Study Sessions — Day 24.
 *
 * Implements the IndexedDB storage layer for StudySession records with
 * indexes for resourceId, startedAt, completedAt, and status.
 */

import { STUDY_SESSION_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';
import {
    createStudySessionRecord,
    createUpdatedStudySession,
    validateStudySession,
} from './studySessionValidation.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        if (typeof request.addEventListener === 'function') {
            request.addEventListener('success', () => resolve(request.result));
            request.addEventListener('error', () => {
                reject(new StorageError('StudyLens could not ' + operation + '.', {
                    code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_SESSION_ID' : 'REQUEST_FAILED',
                    cause: request.error,
                }));
            });
        } else {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                reject(new StorageError('StudyLens could not ' + operation + '.', {
                    code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_SESSION_ID' : 'REQUEST_FAILED',
                    cause: request.error,
                }));
            };
        }
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

function validateSessionId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new StorageError('A session id is required.', { code: 'INVALID_SESSION_ID' });
    }
}

export function sortByStartedAt(sessions, direction = 'descending') {
    const multiplier = direction === 'ascending' ? 1 : -1;

    return [...sessions].sort((first, second) => {
        const timeA = Date.parse(first.startedAt || 0);
        const timeB = Date.parse(second.startedAt || 0);
        return (timeA - timeB) * multiplier;
    });
}

export class StudySessionRepository {
    constructor({ database = studyLensDatabase } = {}) {
        this.database = database;
    }

    async withStore(mode, operation, callback) {
        try {
            const db = await this.database.open();
            const transaction = db.transaction([STUDY_SESSION_STORE], mode);
            const store = transaction.objectStore(STUDY_SESSION_STORE);
            const result = await callback(store, transaction);
            await transactionToPromise(transaction, operation);
            return result;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not ' + operation + '.', 'SESSION_STORAGE_FAILED');
        }
    }

    /**
     * Save (create or update) a study session record.
     *
     * @param {object} session
     * @returns {Promise<object>}
     */
    async saveSession(session) {
        validateStudySession(session);

        await this.withStore('readwrite', 'save study session', (store) => {
            return requestToPromise(store.put(session), 'save study session');
        });

        return session;
    }

    /**
     * Retrieve a study session by its ID.
     *
     * @param {string} sessionId
     * @returns {Promise<object|null>}
     */
    async getSession(sessionId) {
        validateSessionId(sessionId);

        const result = await this.withStore('readonly', 'read study session', (store) => {
            return requestToPromise(store.get(sessionId), 'read study session');
        });

        return result ?? null;
    }

    /**
     * Retrieve all study sessions for a specific resource, sorted newest first.
     *
     * @param {string} resourceId
     * @returns {Promise<object[]>}
     */
    async getSessionsByResource(resourceId) {
        if (typeof resourceId !== 'string' || !resourceId.trim()) return [];

        const sessions = await this.withStore('readonly', 'query study sessions by resource', (store) => {
            if (store.indexNames?.contains?.('resourceId')) {
                const index = store.index('resourceId');
                return requestToPromise(index.getAll(resourceId), 'query study sessions by resource');
            }
            return requestToPromise(store.getAll(), 'query study sessions by resource');
        });

        const filtered = Array.isArray(sessions)
            ? sessions.filter((s) => s.resourceId === resourceId)
            : [];

        return sortByStartedAt(filtered, 'descending');
    }

    /**
     * Retrieve recent study sessions across all resources.
     *
     * @param {number} [limit=10]
     * @returns {Promise<object[]>}
     */
    async getRecentSessions(limit = 10) {
        const sessions = await this.withStore('readonly', 'read all study sessions', (store) => {
            return requestToPromise(store.getAll(), 'read all study sessions');
        });

        const sorted = sortByStartedAt(sessions || [], 'descending');
        return sorted.slice(0, Math.max(1, limit));
    }

    /**
     * Delete a study session by ID.
     *
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    async deleteSession(sessionId) {
        validateSessionId(sessionId);

        return this.withStore('readwrite', 'delete study session', async (store) => {
            const existing = await requestToPromise(store.get(sessionId), 'check study session before delete');
            if (!existing) return false;

            await requestToPromise(store.delete(sessionId), 'delete study session');
            return true;
        });
    }

    /**
     * Cascading cleanup: delete all sessions for a specific resource.
     *
     * @param {string} resourceId
     * @returns {Promise<number>} count of deleted sessions
     */
    async deleteSessionsByResource(resourceId) {
        if (typeof resourceId !== 'string' || !resourceId.trim()) return 0;

        const sessions = await this.getSessionsByResource(resourceId);
        if (sessions.length === 0) return 0;

        await this.withStore('readwrite', 'delete study sessions for resource', async (store) => {
            for (const session of sessions) {
                await requestToPromise(store.delete(session.id), 'delete session for resource');
            }
        });

        return sessions.length;
    }

    /**
     * Count total study sessions.
     *
     * @returns {Promise<number>}
     */
    async countSessions() {
        return this.withStore('readonly', 'count study sessions', (store) => {
            return requestToPromise(store.count(), 'count study sessions');
        });
    }

    /**
     * Clear all study sessions.
     *
     * @returns {Promise<void>}
     */
    async clearSessions() {
        return this.withStore('readwrite', 'clear study sessions', (store) => {
            return requestToPromise(store.clear(), 'clear study sessions');
        });
    }
}

export const studySessionRepository = new StudySessionRepository();
