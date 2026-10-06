/**
 * Processing display state — Day 22.
 *
 * Pure derivation of what the user should see for a resource, combining the
 * persisted Resource record (status + processing metadata) with the live,
 * in-memory queue job (if any). Keeping this logic out of the UI modules
 * guarantees the Library, Resource Viewer, and tests agree.
 *
 * Why `queued` is NOT a persisted ResourceStatus: queued is transient runtime
 * state (the queue is in memory). Persisting it would leave resources stuck in
 * `queued` after a reload and would create a second, competing status system.
 * Queue state therefore overlays the persisted status instead.
 */

import { isRetryableCode, getFailureMessage, INTERRUPTED_CODE } from './processingErrorPolicy.js';
import { PROCESSING_JOB_STATUS, PROCESSING_QUEUE_DEFAULTS } from './processingQueue.js';

/** A persisted `processing` status older than this, with no live job, is stale. */
export const STALE_PROCESSING_THRESHOLD_MS = 60_000;

/**
 * @param {object} resource
 * @param {number} [now]
 * @param {number} [thresholdMs]
 * @returns {boolean}
 */
export function isStaleProcessing(resource, now = Date.now(), thresholdMs = STALE_PROCESSING_THRESHOLD_MS) {
    if (!resource || resource.status !== 'processing') return false;
    const started = Date.parse(resource.metadata?.processingStartedAt ?? resource.updatedAt);
    if (Number.isNaN(started)) return true;
    return now - started > thresholdMs;
}

/**
 * @typedef {object} ProcessingDisplay
 * @property {'pending'|'queued'|'processing'|'stalled'|'completed'|'failed'} state
 * @property {string} label       short badge text
 * @property {string} detail      one-line, stack-free explanation ('' if none)
 * @property {boolean} busy       true while queued/processing (blocks downstream generation)
 * @property {boolean} canRetry
 * @property {boolean} canCancel  only for queued jobs
 * @property {boolean} retryLimitReached
 * @property {string|null} errorCode
 */

/**
 * @param {object} resource
 * @param {object} [options]
 * @param {object|null} [options.job] live queue job snapshot (queued/processing) or null
 * @param {number} [options.maxAttempts]
 * @param {boolean} [options.hasProcessedContent]
 * @param {number} [options.now]
 * @param {number} [options.staleThresholdMs]
 * @returns {ProcessingDisplay}
 */
export function getProcessingDisplay(resource, {
    job = null,
    maxAttempts = PROCESSING_QUEUE_DEFAULTS.maxAttempts,
    hasProcessedContent = false,
    now = Date.now(),
    staleThresholdMs = STALE_PROCESSING_THRESHOLD_MS,
} = {}) {
    const base = {
        busy: false,
        canRetry: false,
        canCancel: false,
        retryLimitReached: false,
        errorCode: null,
        detail: '',
    };

    if (job && job.status === PROCESSING_JOB_STATUS.QUEUED) {
        return {
            ...base,
            state: 'queued',
            label: 'Queued',
            detail: job.attemptCount > 0
                ? `Retrying (attempt ${job.attemptCount + 1} of ${job.maxAttempts ?? maxAttempts}).`
                : 'Waiting for its turn to be processed.',
            busy: true,
            canCancel: true,
        };
    }

    if (job && job.status === PROCESSING_JOB_STATUS.PROCESSING) {
        return {
            ...base,
            state: 'processing',
            label: 'Processing…',
            detail: job.attemptCount > 1
                ? `Attempt ${job.attemptCount} of ${job.maxAttempts ?? maxAttempts}.`
                : '',
            busy: true,
        };
    }

    const attempts = Number(resource?.metadata?.processingAttempts) || 0;

    if (resource?.status === 'processing') {
        if (isStaleProcessing(resource, now, staleThresholdMs)) {
            const limitReached = attempts >= maxAttempts;
            return {
                ...base,
                state: 'stalled',
                label: 'Processing interrupted',
                detail: getFailureMessage(INTERRUPTED_CODE),
                canRetry: !limitReached,
                retryLimitReached: limitReached,
                errorCode: INTERRUPTED_CODE,
            };
        }
        return { ...base, state: 'processing', label: 'Processing…', busy: true };
    }

    if (resource?.status === 'failed') {
        const code = resource.metadata?.processingErrorCode ?? null;
        const retryable = typeof resource.metadata?.processingRetryable === 'boolean'
            ? resource.metadata.processingRetryable
            : isRetryableCode(code);
        const limitReached = retryable && attempts >= maxAttempts;
        const message = getFailureMessage(code);

        let label = 'Processing failed';
        if (code === 'TRANSCRIPT_UNAVAILABLE') label = 'Transcript unavailable';

        const notes = [message];
        if (limitReached) notes.push(`Retry limit reached (${maxAttempts} attempts).`);
        if (hasProcessedContent) notes.push('Your previous processed content is still available.');

        return {
            ...base,
            state: 'failed',
            label,
            detail: notes.join(' '),
            canRetry: retryable && !limitReached,
            retryLimitReached: limitReached,
            errorCode: code,
        };
    }

    if (resource?.status === 'completed') {
        return { ...base, state: 'completed', label: 'Completed' };
    }

    return { ...base, state: 'pending', label: 'Pending' };
}
