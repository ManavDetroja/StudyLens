/**
 * Note Validation and Factory Module — Day 15.
 *
 * Enforces schema validation for Note records in StudyLensDB:
 * - id: unique UUID string (immutable)
 * - resourceId: nullable string (links note to a Resource, or null for standalone notes)
 * - title: non-empty trimmed string (max 200 chars)
 * - content: non-empty trimmed string (plain or structured text)
 * - tags: array of normalized, lowercase tag strings
 * - metadata: extensible object
 * - createdAt: ISO 8601 timestamp (immutable)
 * - updatedAt: ISO 8601 timestamp (updated on edit)
 */

import { NoteValidationError } from './errors.js';
import { normalizeTagArray, normalizeTags, validateTags } from '../utils/tagUtils.js';

export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 100000;

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isValidIsoTimestamp(value) {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && !Number.isNaN(Date.parse(value));
}

function createTimestamp(clock) {
    const value = clock();
    return value instanceof Date ? value.toISOString() : value;
}

/**
 * Generates a unique note ID using crypto.randomUUID.
 *
 * @returns {string} UUID
 */
export function generateNoteId() {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new NoteValidationError('This browser cannot generate secure note IDs.', {
            code: 'UUID_UNAVAILABLE',
        });
    }

    return globalThis.crypto.randomUUID();
}

/**
 * Validates a Note record against schema requirements.
 *
 * @param {object} note
 * @returns {object} validated note
 * @throws {NoteValidationError} if invalid
 */
export function validateNote(note) {
    if (!isPlainObject(note)) {
        throw new NoteValidationError('A note must be an object.');
    }

    const problems = [];

    if (typeof note.id !== 'string' || note.id.trim() === '') {
        problems.push('id must be a non-empty string');
    }

    // resourceId can be null, undefined, or a non-empty string
    if (note.resourceId !== null && note.resourceId !== undefined) {
        if (typeof note.resourceId !== 'string' || note.resourceId.trim() === '') {
            problems.push('resourceId must be null or a non-empty string');
        }
    }

    if (typeof note.title !== 'string' || note.title.trim() === '') {
        problems.push('title must be a non-empty string');
    } else if (note.title.trim().length > NOTE_TITLE_MAX_LENGTH) {
        problems.push(`title must not exceed ${NOTE_TITLE_MAX_LENGTH} characters`);
    }

    if (typeof note.content !== 'string' || note.content.trim() === '') {
        problems.push('content must be a non-empty string');
    } else if (note.content.length > NOTE_CONTENT_MAX_LENGTH) {
        problems.push(`content must not exceed ${NOTE_CONTENT_MAX_LENGTH} characters`);
    }

    if (!Array.isArray(note.tags)) {
        problems.push('tags must be an array');
    } else {
        try {
            validateTags(note.tags);
        } catch (tagError) {
            problems.push(tagError.message);
        }
    }

    if (!isValidIsoTimestamp(note.createdAt)) {
        problems.push('createdAt must be an ISO timestamp');
    }

    if (!isValidIsoTimestamp(note.updatedAt)) {
        problems.push('updatedAt must be an ISO timestamp');
    }

    if (!isPlainObject(note.metadata ?? {})) {
        problems.push('metadata must be an object');
    }

    if (problems.length > 0) {
        throw new NoteValidationError('Invalid note: ' + problems.join('; ') + '.');
    }

    return note;
}

/**
 * Creates a validated Note record from raw input values.
 *
 * @param {object} input
 * @param {object} [options]
 * @param {Function} [options.idGenerator]
 * @param {Function} [options.clock]
 * @returns {object} validated Note record
 */
export function createNoteRecord(input, {
    idGenerator = generateNoteId,
    clock = () => new Date().toISOString(),
} = {}) {
    if (!isPlainObject(input)) {
        throw new NoteValidationError('Note input must be an object.');
    }

    const id = typeof input.id === 'string' && input.id.trim() !== ''
        ? input.id.trim()
        : idGenerator();

    const resourceId = input.resourceId && typeof input.resourceId === 'string' && input.resourceId.trim() !== ''
        ? input.resourceId.trim()
        : null;

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const content = typeof input.content === 'string' ? input.content.trim() : '';

    let tags = [];
    if (typeof input.rawTags === 'string') {
        tags = normalizeTags(input.rawTags);
    } else if (Array.isArray(input.tags)) {
        tags = normalizeTagArray(input.tags);
    } else if (typeof input.tags === 'string') {
        tags = normalizeTags(input.tags);
    }

    const createdAt = input.createdAt && isValidIsoTimestamp(input.createdAt)
        ? input.createdAt
        : createTimestamp(clock);

    const updatedAt = input.updatedAt && isValidIsoTimestamp(input.updatedAt)
        ? input.updatedAt
        : createdAt;

    const metadata = isPlainObject(input.metadata) ? { ...input.metadata } : {};

    const record = {
        id,
        resourceId,
        title,
        content,
        tags,
        metadata,
        createdAt,
        updatedAt,
    };

    return validateNote(record);
}

/**
 * Creates an updated Note record, preserving immutable fields (id, createdAt).
 *
 * @param {object} existingNote
 * @param {object} updates
 * @param {object} [options]
 * @param {Function} [options.clock]
 * @returns {object} updated and validated Note record
 */
export function createUpdatedNoteRecord(existingNote, updates, {
    clock = () => new Date().toISOString(),
} = {}) {
    if (!isPlainObject(existingNote)) {
        throw new NoteValidationError('Existing note must be an object.');
    }
    if (!isPlainObject(updates)) {
        throw new NoteValidationError('Note updates must be an object.');
    }
    if (Object.hasOwn(updates, 'id') || Object.hasOwn(updates, 'createdAt')) {
        throw new NoteValidationError('Note id and createdAt are immutable and cannot be modified.', {
            code: 'IMMUTABLE_NOTE_FIELD',
        });
    }

    // ResourceId: if explicitly provided in updates, update it (or clear if null/empty); else preserve
    let resourceId = existingNote.resourceId ?? null;
    if ('resourceId' in updates) {
        resourceId = updates.resourceId && typeof updates.resourceId === 'string' && updates.resourceId.trim() !== ''
            ? updates.resourceId.trim()
            : null;
    }

    const title = typeof updates.title === 'string' ? updates.title.trim() : existingNote.title;
    const content = typeof updates.content === 'string' ? updates.content.trim() : existingNote.content;

    let tags = existingNote.tags ?? [];
    if (typeof updates.rawTags === 'string') {
        tags = normalizeTags(updates.rawTags);
    } else if (Array.isArray(updates.tags)) {
        tags = normalizeTagArray(updates.tags);
    } else if (typeof updates.tags === 'string') {
        tags = normalizeTags(updates.tags);
    }

    const metadata = isPlainObject(updates.metadata)
        ? { ...(existingNote.metadata ?? {}), ...updates.metadata }
        : { ...(existingNote.metadata ?? {}) };

    const updatedRecord = {
        id: existingNote.id,
        resourceId,
        title,
        content,
        tags,
        metadata,
        createdAt: existingNote.createdAt,
        updatedAt: createTimestamp(clock),
    };

    return validateNote(updatedRecord);
}
