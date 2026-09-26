/**
 * Persistent Storage Repository for Notes — Day 15.
 *
 * Implements the IndexedDB storage layer for Note records with
 * indexes for resourceId, updatedAt, and createdAt.
 */

import { NOTE_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';
import {
    createNoteRecord,
    createUpdatedNoteRecord,
    generateNoteId,
    validateNote,
} from './noteValidation.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_NOTE_ID' : 'REQUEST_FAILED',
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

function validateNoteId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new StorageError('A note id is required.', { code: 'INVALID_NOTE_ID' });
    }
}

export function sortByUpdatedAt(notes, direction = 'descending') {
    const multiplier = direction === 'ascending' ? 1 : -1;

    return [...notes].sort((first, second) => {
        const timeA = Date.parse(first.updatedAt || first.createdAt || 0);
        const timeB = Date.parse(second.updatedAt || second.createdAt || 0);
        return (timeA - timeB) * multiplier;
    });
}

export class NoteRepository {
    constructor({
        database = studyLensDatabase,
        idGenerator = generateNoteId,
        clock = () => new Date().toISOString(),
    } = {}) {
        this.database = database;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    async #getStore(mode = 'readonly') {
        const db = await this.database.open();
        const transaction = db.transaction(NOTE_STORE, mode);
        return {
            store: transaction.objectStore(NOTE_STORE),
            transaction,
        };
    }

    /**
     * Create and persist a new Note record.
     *
     * @param {object} input
     * @returns {Promise<object>} stored Note record
     */
    async createNote(input) {
        const record = createNoteRecord(input, {
            idGenerator: this.idGenerator,
            clock: this.clock,
        });

        try {
            const { store, transaction } = await this.#getStore('readwrite');
            await requestToPromise(store.add(record), 'save note');
            await transactionToPromise(transaction, 'save note');
            return record;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not save this note.', 'SAVE_NOTE_FAILED');
        }
    }

    /**
     * Retrieve a specific note by ID.
     *
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getNote(id) {
        validateNoteId(id);

        try {
            const { store, transaction } = await this.#getStore('readonly');
            const result = await requestToPromise(store.get(id), 'read note');
            await transactionToPromise(transaction, 'read note');
            return result ? validateNote(result) : null;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not read this note.', 'READ_NOTE_FAILED');
        }
    }

    /**
     * Retrieve all notes, sorted by updatedAt descending.
     *
     * @returns {Promise<Array<object>>}
     */
    async getAllNotes() {
        try {
            const { store, transaction } = await this.#getStore('readonly');
            const results = await requestToPromise(store.getAll(), 'read notes');
            await transactionToPromise(transaction, 'read notes');
            return sortByUpdatedAt(results.map(validateNote));
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not read notes.', 'READ_NOTES_FAILED');
        }
    }

    /**
     * Retrieve all notes associated with a given resourceId, sorted by updatedAt descending.
     *
     * @param {string} resourceId
     * @returns {Promise<Array<object>>}
     */
    async getNotesByResource(resourceId) {
        if (typeof resourceId !== 'string' || resourceId.trim() === '') {
            return [];
        }

        try {
            const { store, transaction } = await this.#getStore('readonly');
            const index = store.index('resourceId');
            const results = await requestToPromise(index.getAll(resourceId), 'read resource notes');
            await transactionToPromise(transaction, 'read resource notes');
            return sortByUpdatedAt(results.map(validateNote));
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not read notes for this resource.', 'READ_NOTES_FAILED');
        }
    }

    /**
     * Update an existing note, preserving its immutable id and createdAt.
     *
     * @param {string} id
     * @param {object} updates
     * @returns {Promise<object>} updated Note record
     */
    async updateNote(id, updates) {
        validateNoteId(id);

        const existing = await this.getNote(id);
        if (!existing) {
            throw new StorageError('Note not found.', { code: 'NOTE_NOT_FOUND' });
        }

        const updatedRecord = createUpdatedNoteRecord(existing, updates, {
            clock: this.clock,
        });

        try {
            const { store, transaction } = await this.#getStore('readwrite');
            await requestToPromise(store.put(updatedRecord), 'update note');
            await transactionToPromise(transaction, 'update note');
            return updatedRecord;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not update this note.', 'UPDATE_NOTE_FAILED');
        }
    }

    /**
     * Delete a specific note by ID.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteNote(id) {
        validateNoteId(id);

        const existing = await this.getNote(id);
        if (!existing) return false;

        try {
            const { store, transaction } = await this.#getStore('readwrite');
            await requestToPromise(store.delete(id), 'delete note');
            await transactionToPromise(transaction, 'delete note');
            return true;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not delete this note.', 'DELETE_NOTE_FAILED');
        }
    }

    /**
     * Delete all notes associated with a given resourceId.
     *
     * @param {string} resourceId
     * @returns {Promise<number>} count of deleted notes
     */
    async deleteNotesByResource(resourceId) {
        if (typeof resourceId !== 'string' || resourceId.trim() === '') {
            return 0;
        }

        const notes = await this.getNotesByResource(resourceId);
        if (notes.length === 0) return 0;

        try {
            const { store, transaction } = await this.#getStore('readwrite');
            for (const note of notes) {
                await requestToPromise(store.delete(note.id), 'delete resource note');
            }
            await transactionToPromise(transaction, 'delete resource notes');
            return notes.length;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not delete notes for this resource.', 'DELETE_NOTES_FAILED');
        }
    }

    /**
     * Count total notes in storage.
     *
     * @returns {Promise<number>}
     */
    async countNotes() {
        try {
            const { store, transaction } = await this.#getStore('readonly');
            const count = await requestToPromise(store.count(), 'count notes');
            await transactionToPromise(transaction, 'count notes');
            return count;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not count notes.', 'COUNT_NOTES_FAILED');
        }
    }

    /**
     * Clear all notes from the store.
     *
     * @returns {Promise<number>} count cleared
     */
    async clearNotes() {
        const count = await this.countNotes();

        try {
            const { store, transaction } = await this.#getStore('readwrite');
            await requestToPromise(store.clear(), 'clear notes');
            await transactionToPromise(transaction, 'clear notes');
            return count;
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not clear notes.', 'CLEAR_NOTES_FAILED');
        }
    }
}

export const noteRepository = new NoteRepository();
