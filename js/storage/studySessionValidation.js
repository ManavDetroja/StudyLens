/**
 * Study Session Validation & Modeling — Day 24.
 *
 * Defines the lightweight Study Session data model, validation rules,
 * status lifecycle ('active' | 'completed' | 'abandoned'), and duration formatting.
 */

import { ResourceValidationError } from './errors.js';

export const STUDY_SESSION_STATUSES = Object.freeze([
    'active',
    'completed',
    'abandoned',
]);

/**
 * Validates an ISO timestamp string.
 *
 * @param {string} timestamp
 * @returns {boolean}
 */
export function isValidTimestamp(timestamp) {
    if (typeof timestamp !== 'string' || !timestamp.trim()) return false;
    const time = Date.parse(timestamp);
    return !Number.isNaN(time);
}

/**
 * Calculate elapsed duration in milliseconds between two timestamps.
 *
 * @param {string} startedAt
 * @param {string} [completedAt]
 * @returns {number}
 */
export function calculateElapsedMs(startedAt, completedAt = null) {
    const start = Date.parse(startedAt);
    if (Number.isNaN(start)) return 0;
    const end = completedAt ? Date.parse(completedAt) : Date.now();
    if (Number.isNaN(end)) return 0;
    return Math.max(0, end - start);
}

/**
 * Formats a duration in milliseconds into a concise human-readable string.
 * e.g. 45000 -> "45s", 252000 -> "4m 12s", 3660000 -> "1h 1m"
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatSessionDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Validates a StudySession object.
 * Throws ResourceValidationError if invalid.
 *
 * @param {object} session
 * @returns {object} validated session
 */
export function validateStudySession(session) {
    if (!session || typeof session !== 'object') {
        throw new ResourceValidationError('Study session must be an object.', {
            code: 'SESSION_INVALID',
        });
    }

    if (typeof session.id !== 'string' || !session.id.trim()) {
        throw new ResourceValidationError('Study session requires a valid id.', {
            code: 'SESSION_ID_REQUIRED',
        });
    }

    if (typeof session.resourceId !== 'string' || !session.resourceId.trim()) {
        throw new ResourceValidationError('Study session requires a valid resourceId.', {
            code: 'SESSION_RESOURCE_ID_REQUIRED',
        });
    }

    if (!isValidTimestamp(session.startedAt)) {
        throw new ResourceValidationError('Study session requires a valid startedAt timestamp.', {
            code: 'SESSION_STARTED_AT_INVALID',
        });
    }

    if (session.completedAt !== null && session.completedAt !== undefined && !isValidTimestamp(session.completedAt)) {
        throw new ResourceValidationError('Study session completedAt must be a valid timestamp when provided.', {
            code: 'SESSION_COMPLETED_AT_INVALID',
        });
    }

    if (!STUDY_SESSION_STATUSES.includes(session.status)) {
        throw new ResourceValidationError(
            `Study session status must be one of: ${STUDY_SESSION_STATUSES.join(', ')}.`,
            { code: 'SESSION_STATUS_INVALID' }
        );
    }

    if (!Array.isArray(session.stepsCompleted)) {
        throw new ResourceValidationError('Study session stepsCompleted must be an array.', {
            code: 'SESSION_STEPS_INVALID',
        });
    }

    return session;
}

/**
 * Creates a validated StudySession record.
 *
 * @param {object} input
 * @param {string} [input.id]
 * @param {string} input.resourceId
 * @param {string} [input.startedAt]
 * @param {string|null} [input.completedAt]
 * @param {string} [input.status]
 * @param {string[]} [input.stepsCompleted]
 * @param {number} [input.durationMs]
 * @param {object} [input.metadata]
 * @returns {object} StudySession record
 */
export function createStudySessionRecord(input = {}) {
    const id = typeof input.id === 'string' && input.id.trim()
        ? input.id.trim()
        : crypto.randomUUID();

    const resourceId = typeof input.resourceId === 'string' ? input.resourceId.trim() : '';
    const startedAt = typeof input.startedAt === 'string' && input.startedAt.trim()
        ? input.startedAt.trim()
        : new Date().toISOString();

    const completedAt = typeof input.completedAt === 'string' && input.completedAt.trim()
        ? input.completedAt.trim()
        : null;

    const status = input.status || 'active';
    const stepsCompleted = Array.isArray(input.stepsCompleted)
        ? [...new Set(input.stepsCompleted.filter((s) => typeof s === 'string' && s.trim()))]
        : [];

    const durationMs = typeof input.durationMs === 'number' && input.durationMs >= 0
        ? Math.floor(input.durationMs)
        : (completedAt ? calculateElapsedMs(startedAt, completedAt) : 0);

    const metadata = input.metadata && typeof input.metadata === 'object'
        ? { ...input.metadata }
        : {};

    const session = {
        id,
        resourceId,
        startedAt,
        completedAt,
        status,
        stepsCompleted,
        durationMs,
        metadata,
    };

    return validateStudySession(session);
}

/**
 * Creates an updated StudySession record, preserving identity and immutables.
 *
 * @param {object} existingSession
 * @param {object} updates
 * @returns {object} updated StudySession
 */
export function createUpdatedStudySession(existingSession, updates = {}) {
    validateStudySession(existingSession);

    if (Object.hasOwn(updates, 'id') || Object.hasOwn(updates, 'resourceId') || Object.hasOwn(updates, 'startedAt')) {
        throw new ResourceValidationError('Study session id, resourceId, and startedAt cannot be changed.', {
            code: 'IMMUTABLE_STUDY_SESSION_FIELD',
        });
    }

    const completedAt = updates.completedAt !== undefined
        ? updates.completedAt
        : existingSession.completedAt;

    const status = updates.status !== undefined
        ? updates.status
        : existingSession.status;

    const stepsCompleted = Array.isArray(updates.stepsCompleted)
        ? [...new Set(updates.stepsCompleted.filter((s) => typeof s === 'string' && s.trim()))]
        : existingSession.stepsCompleted;

    const durationMs = updates.durationMs !== undefined
        ? Math.floor(Math.max(0, Number(updates.durationMs) || 0))
        : (completedAt ? calculateElapsedMs(existingSession.startedAt, completedAt) : existingSession.durationMs);

    const metadata = updates.metadata && typeof updates.metadata === 'object'
        ? { ...existingSession.metadata, ...updates.metadata }
        : existingSession.metadata;

    const updated = {
        id: existingSession.id,
        resourceId: existingSession.resourceId,
        startedAt: existingSession.startedAt,
        completedAt,
        status,
        stepsCompleted,
        durationMs,
        metadata,
    };

    return validateStudySession(updated);
}
