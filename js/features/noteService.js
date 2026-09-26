/**
 * Note Service — Day 15.
 *
 * Coordinates Note domain operations:
 * - CRUD operations via NoteRepository with reactive event notifications
 * - Cascading cleanup when resources are deleted
 * - Pure, deterministic local search across title, content, and tags
 * - Resource-based filtering (All, Standalone, or specific Resource)
 */

import { noteRepository } from '../storage/noteStore.js';
import { notifyNotesChanged } from '../core/resourceEvents.js';

/**
 * Normalizes a search query string for whitespace-tolerant, case-insensitive comparison.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeSearchQuery(text) {
    if (typeof text !== 'string') return '';
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Builds a normalized, searchable text string from a note's title, content, and tags.
 *
 * @param {object} note
 * @returns {string}
 */
export function buildNoteSearchableText(note) {
    if (!note) return '';
    const parts = [
        note.title ?? '',
        note.content ?? '',
        ...(Array.isArray(note.tags) ? note.tags : []),
    ];
    return normalizeSearchQuery(parts.join(' '));
}

/**
 * Searches an array of notes against title, content, and tags.
 * Returns all notes when the query is empty.
 *
 * @param {Array<object>} notes
 * @param {string} query
 * @returns {Array<object>}
 */
export function searchNotes(notes, query = '') {
    if (!Array.isArray(notes)) return [];

    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return [...notes];

    return notes.filter((note) => {
        return buildNoteSearchableText(note).includes(normalizedQuery);
    });
}

/**
 * Filters notes by their associated resource.
 *
 * @param {Array<object>} notes
 * @param {string} [resourceId='all'] — 'all', 'standalone', or specific resourceId
 * @returns {Array<object>}
 */
export function filterNotesByResource(notes, resourceId = 'all') {
    if (!Array.isArray(notes)) return [];
    if (!resourceId || resourceId === 'all') return [...notes];

    if (resourceId === 'standalone') {
        return notes.filter((n) => !n.resourceId);
    }

    return notes.filter((n) => n.resourceId === resourceId);
}

/**
 * Filters and searches notes in a single pipeline.
 *
 * @param {Array<object>} notes
 * @param {object} [options]
 * @param {string} [options.query='']
 * @param {string} [options.resourceId='all']
 * @returns {Array<object>}
 */
export function filterAndSearchNotes(notes, { query = '', resourceId = 'all' } = {}) {
    const resourceFiltered = filterNotesByResource(notes, resourceId);
    return searchNotes(resourceFiltered, query);
}

/**
 * Creates and persists a new note in storage.
 *
 * @param {object} input
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<object>} stored Note record
 */
export async function createNote(input, options = {}) {
    const repo = options.repo ?? noteRepository;
    const note = await repo.createNote(input);

    notifyNotesChanged({
        action: 'created',
        noteId: note.id,
        resourceId: note.resourceId,
    });

    return note;
}

/**
 * Retrieves a specific note by ID.
 *
 * @param {string} id
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<object|null>}
 */
export async function getNote(id, options = {}) {
    const repo = options.repo ?? noteRepository;
    return repo.getNote(id);
}

/**
 * Retrieves all notes from storage, sorted by updatedAt descending.
 *
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<Array<object>>}
 */
export async function getAllNotes(options = {}) {
    const repo = options.repo ?? noteRepository;
    return repo.getAllNotes();
}

/**
 * Retrieves all notes associated with a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<Array<object>>}
 */
export async function getNotesByResource(resourceId, options = {}) {
    const repo = options.repo ?? noteRepository;
    return repo.getNotesByResource(resourceId);
}

/**
 * Updates an existing note in storage, preserving immutable id and createdAt.
 *
 * @param {string} id
 * @param {object} updates
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<object>} updated Note record
 */
export async function updateNote(id, updates, options = {}) {
    const repo = options.repo ?? noteRepository;
    const updated = await repo.updateNote(id, updates);

    notifyNotesChanged({
        action: 'updated',
        noteId: updated.id,
        resourceId: updated.resourceId,
    });

    return updated;
}

/**
 * Deletes a specific note by ID.
 *
 * @param {string} id
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<boolean>}
 */
export async function deleteNote(id, options = {}) {
    const repo = options.repo ?? noteRepository;
    const deleted = await repo.deleteNote(id);

    if (deleted) {
        notifyNotesChanged({
            action: 'deleted',
            noteId: id,
        });
    }

    return deleted;
}

/**
 * Deletes all notes associated with a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<number>} count of deleted notes
 */
export async function deleteNotesForResource(resourceId, options = {}) {
    const repo = options.repo ?? noteRepository;
    const count = await repo.deleteNotesByResource(resourceId);

    if (count > 0) {
        notifyNotesChanged({
            action: 'deleted_by_resource',
            resourceId,
            count,
        });
    }

    return count;
}

/**
 * Counts total notes in storage.
 *
 * @param {object} [options]
 * @param {object} [options.repo]
 * @returns {Promise<number>}
 */
export async function countNotes(options = {}) {
    const repo = options.repo ?? noteRepository;
    return repo.countNotes();
}
