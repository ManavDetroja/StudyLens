import { LearningOutputValidationError } from './errors.js';

export const LEARNING_OUTPUT_TYPES = Object.freeze([
    'summary',
    'notes',
    'concept',
    'definition',
    'question',
    'flashcard',
    'quiz',
]);

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

export function generateLearningOutputId() {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new LearningOutputValidationError('This browser cannot generate secure learning output IDs.', {
            code: 'UUID_UNAVAILABLE',
        });
    }

    return globalThis.crypto.randomUUID();
}

/**
 * Validates a LearningOutput record against schema requirements.
 *
 * @param {object} output
 * @returns {object} validated output
 * @throws {LearningOutputValidationError} if output is invalid
 */
export function validateLearningOutput(output) {
    if (!isPlainObject(output)) {
        throw new LearningOutputValidationError('A learning output must be an object.');
    }

    const problems = [];

    if (typeof output.id !== 'string' || output.id.trim() === '') {
        problems.push('id must be a non-empty string');
    }
    if (typeof output.resourceId !== 'string' || output.resourceId.trim() === '') {
        problems.push('resourceId must be a non-empty string');
    }
    if (!LEARNING_OUTPUT_TYPES.includes(output.type)) {
        problems.push('type must be one of: ' + LEARNING_OUTPUT_TYPES.join(', '));
    }

    // Content: non-empty string OR non-empty plain object
    if (typeof output.content === 'string') {
        if (output.content.trim() === '') {
            problems.push('content string cannot be empty');
        }
    } else if (isPlainObject(output.content)) {
        if (Object.keys(output.content).length === 0) {
            problems.push('content object cannot be empty');
        }
    } else {
        problems.push('content must be a non-empty string or object');
    }

    // Source traceability: array of string or integer chunk IDs/indices
    if (!Array.isArray(output.sourceChunkIds)) {
        problems.push('sourceChunkIds must be an array');
    } else {
        const hasInvalidChunkId = output.sourceChunkIds.some((chunkId) => {
            if (typeof chunkId === 'number') {
                return !Number.isInteger(chunkId) || chunkId < 0;
            }
            if (typeof chunkId === 'string') {
                return chunkId.trim() === '';
            }
            return true;
        });
        if (hasInvalidChunkId) {
            problems.push('sourceChunkIds elements must be non-negative integers or non-empty strings');
        }
    }

    if (!isPlainObject(output.metadata)) {
        problems.push('metadata must be an object');
    }

    if (!isValidIsoTimestamp(output.createdAt)) {
        problems.push('createdAt must be an ISO timestamp');
    }
    if (!isValidIsoTimestamp(output.updatedAt)) {
        problems.push('updatedAt must be an ISO timestamp');
    }
    if (isValidIsoTimestamp(output.createdAt) && isValidIsoTimestamp(output.updatedAt)
        && Date.parse(output.updatedAt) < Date.parse(output.createdAt)) {
        problems.push('updatedAt cannot be earlier than createdAt');
    }

    if (problems.length > 0) {
        throw new LearningOutputValidationError('Invalid learning output: ' + problems.join('; ') + '.');
    }

    return output;
}

/**
 * Creates and validates a new LearningOutput record.
 */
export function createLearningOutputRecord(input, {
    idGenerator = generateLearningOutputId,
    clock = () => new Date(),
} = {}) {
    if (!isPlainObject(input)) {
        throw new LearningOutputValidationError('Learning output input must be an object.');
    }

    const timestamp = createTimestamp(clock);
    const content = typeof input.content === 'string' ? input.content.trim() : input.content;

    const record = {
        id: idGenerator(),
        resourceId: typeof input.resourceId === 'string' ? input.resourceId.trim() : input.resourceId,
        type: input.type,
        content,
        sourceChunkIds: Array.isArray(input.sourceChunkIds) ? [...input.sourceChunkIds] : [],
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    return validateLearningOutput(record);
}

/**
 * Creates an updated LearningOutput record, enforcing immutability of id, resourceId, and createdAt.
 */
export function createUpdatedLearningOutput(existingRecord, updates, {
    clock = () => new Date(),
} = {}) {
    validateLearningOutput(existingRecord);

    if (!isPlainObject(updates)) {
        throw new LearningOutputValidationError('Learning output updates must be an object.');
    }

    if (Object.hasOwn(updates, 'id') || Object.hasOwn(updates, 'resourceId') || Object.hasOwn(updates, 'createdAt')) {
        throw new LearningOutputValidationError('Learning output id, resourceId, and createdAt cannot be changed.', {
            code: 'IMMUTABLE_OUTPUT_FIELD',
        });
    }

    const allowedFields = ['type', 'content', 'sourceChunkIds', 'metadata'];
    const allowedUpdates = {};

    allowedFields.forEach((field) => {
        if (Object.hasOwn(updates, field)) allowedUpdates[field] = updates[field];
    });

    const content = Object.hasOwn(allowedUpdates, 'content')
        ? (typeof allowedUpdates.content === 'string' ? allowedUpdates.content.trim() : allowedUpdates.content)
        : existingRecord.content;

    const updated = {
        ...existingRecord,
        ...allowedUpdates,
        content,
        sourceChunkIds: Object.hasOwn(allowedUpdates, 'sourceChunkIds')
            ? (Array.isArray(allowedUpdates.sourceChunkIds) ? [...allowedUpdates.sourceChunkIds] : allowedUpdates.sourceChunkIds)
            : existingRecord.sourceChunkIds,
        updatedAt: createTimestamp(clock),
    };

    return validateLearningOutput(updated);
}
