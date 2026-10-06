/**
 * Processing service — Day 22.
 *
 * Wires the storage-agnostic ProcessingQueue to the unified processing
 * orchestrator (processingIntegration.js) and the project event system.
 * UI modules call this service; they never touch the queue's internals and
 * the queue never touches the UI.
 *
 *   UI → processingService → ProcessingQueue → processResourceById
 *        → source adapter → normalize → chunk → persist → events → UI
 *
 * This is a browser-local queue. It does not survive the tab being closed;
 * `recoverStaleProcessing` repairs any persisted `processing` status left
 * behind by an interrupted tab so the user can retry.
 */

import { ProcessingQueue, PROCESSING_QUEUE_DEFAULTS, PROCESSING_REASONS } from '../processing/processingQueue.js';
import { ContentProcessingError } from '../processing/errors.js';
import {
    INTERRUPTED_CODE,
    RETRY_LIMIT_CODE,
    getFailureMessage,
    isRetryableCode,
} from '../processing/processingErrorPolicy.js';
import { isStaleProcessing, STALE_PROCESSING_THRESHOLD_MS } from '../processing/processingDisplay.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { notifyProcessingChanged, notifyResourcesChanged } from '../core/resourceEvents.js';
import { processResourceById, isResourceProcessing } from './processingIntegration.js';

/**
 * Default, configurable queue settings.
 *
 * maxConcurrent = 1: PDF parsing and OCR are CPU/memory heavy and share one
 * browser main thread (and, for OCR, one worker pool). Running them one at a
 * time keeps the UI responsive and avoids duplicate parser/OCR initialisation.
 */
export const PROCESSING_CONFIG = Object.freeze({
    ...PROCESSING_QUEUE_DEFAULTS,
    staleThresholdMs: STALE_PROCESSING_THRESHOLD_MS,
});

/**
 * Create a processing service. Exposed as a factory so tests can inject
 * repositories and processing options; the application uses the singleton.
 *
 * @param {object} [options]
 * @param {object} [options.resRepo]
 * @param {object} [options.processedRepo]
 * @param {object} [options.processOptions] — passed to every run (e.g. ocrExtractor, pipeline)
 * @param {object} [options.queueOptions]   — overrides for ProcessingQueue
 * @param {Function} [options.runner]       — replaces the default runner (tests)
 */
export function createProcessingService({
    resRepo = resourceRepository,
    processedRepo,
    processOptions = {},
    queueOptions = {},
    runner = null,
} = {}) {
    const defaultRunner = ({ resourceId, attemptNumber }) => processResourceById(resourceId, {
        resRepo,
        ...(processedRepo ? { processedRepo } : {}),
        ...processOptions,
        attemptNumber,
    });

    const queue = new ProcessingQueue({
        maxConcurrent: PROCESSING_CONFIG.maxConcurrent,
        maxAttempts: PROCESSING_CONFIG.maxAttempts,
        autoRetry: PROCESSING_CONFIG.autoRetry,
        ...queueOptions,
        runner: runner ?? defaultRunner,
        onEvent: ({ action, job, queue: queueSnapshot }) => {
            notifyProcessingChanged({ action, resourceId: job.resourceId, job, queue: queueSnapshot });
            if (queueOptions.onEvent) queueOptions.onEvent({ action, job, queue: queueSnapshot });
        },
    });

    async function loadResource(resourceId) {
        const resource = await resRepo.getResource(resourceId);
        if (!resource) {
            throw new ContentProcessingError('Resource not found: ' + resourceId, {
                code: 'RESOURCE_NOT_FOUND',
            });
        }
        return resource;
    }

    /**
     * Request processing. Safe to call repeatedly: a resource that is already
     * queued or processing is de-duplicated into the existing job.
     *
     * @param {string} resourceId
     * @param {{ reason?: string }} [options] reason 'source-changed' when the user's
     *   source content was edited (schedules a re-run even if a job is active).
     */
    async function requestProcessing(resourceId, { reason = PROCESSING_REASONS.REQUESTED } = {}) {
        if (queue.isBusy(resourceId)) {
            return queue.enqueue(resourceId, { reason });
        }
        const resource = await loadResource(resourceId);
        return queue.enqueue(resourceId, { sourceType: resource.type, reason });
    }

    /**
     * Retry a failed or interrupted resource. Enforces the attempt limit and
     * refuses known-permanent failures.
     */
    async function retryProcessing(resourceId) {
        if (queue.isBusy(resourceId)) {
            return queue.retry(resourceId);
        }
        const resource = await loadResource(resourceId);
        const meta = resource.metadata ?? {};
        const code = meta.processingErrorCode ?? null;

        if (resource.status === 'failed') {
            const retryable = typeof meta.processingRetryable === 'boolean'
                ? meta.processingRetryable
                : isRetryableCode(code);
            if (!retryable) {
                return {
                    accepted: false,
                    deduplicated: false,
                    job: null,
                    completion: Promise.resolve(null),
                    reason: 'NON_RETRYABLE',
                };
            }
        }

        return queue.retry(resourceId, {
            attemptCount: Number(meta.processingAttempts) || 0,
            sourceType: resource.type,
        });
    }

    /** Cancel a queued job. Active jobs cannot be cancelled (documented limitation). */
    function cancelProcessing(resourceId) {
        return queue.cancel(resourceId);
    }

    function isBusy(resourceId) {
        return queue.isBusy(resourceId) || isResourceProcessing(resourceId);
    }

    /**
     * Throw if the resource is queued or processing. Downstream generation
     * (outputs, flashcards, quizzes) calls this so it never consumes stale or
     * partial content.
     */
    function assertNotProcessing(resourceId) {
        if (isBusy(resourceId)) {
            throw new ContentProcessingError(
                'This resource is still being processed. Please wait until processing finishes.',
                { code: 'PROCESSING_IN_PROGRESS' },
            );
        }
    }

    /**
     * Repair persisted `processing` statuses that no live job owns.
     * Never marks anything completed; the resource becomes `failed` with a
     * retryable PROCESSING_INTERRUPTED code and its processed content is left
     * untouched.
     *
     * @returns {Promise<string[]>} ids of recovered resources
     */
    async function recoverStaleProcessing({
        now = Date.now(),
        thresholdMs = PROCESSING_CONFIG.staleThresholdMs,
    } = {}) {
        const recovered = [];
        const resources = await resRepo.getAllResources();

        for (const candidate of resources) {
            if (queue.isBusy(candidate.id) || !isStaleProcessing(candidate, now, thresholdMs)) continue;

            const latest = await resRepo.getResource(candidate.id);
            if (!latest || queue.isBusy(latest.id) || !isStaleProcessing(latest, now, thresholdMs)) continue;

            const meta = { ...(latest.metadata ?? {}) };
            meta.processingError = getFailureMessage(INTERRUPTED_CODE);
            meta.processingErrorCode = INTERRUPTED_CODE;
            meta.processingRetryable = true;
            meta.processingFailedAt = new Date().toISOString();
            delete meta.processingStartedAt;

            await resRepo.updateResource(latest.id, { status: 'failed', metadata: meta });
            recovered.push(latest.id);
            notifyResourcesChanged({ action: 'updated', resourceId: latest.id });
            notifyProcessingChanged({ action: 'recovered', resourceId: latest.id, job: null, queue: queue.getSnapshot() });
        }

        return recovered;
    }

    return {
        queue,
        requestProcessing,
        retryProcessing,
        cancelProcessing,
        isBusy,
        assertNotProcessing,
        recoverStaleProcessing,
        getJob: (resourceId) => queue.getJob(resourceId),
        getLiveJob: (resourceId) => (queue.isBusy(resourceId) ? queue.getJob(resourceId) : null),
        getSnapshot: () => queue.getSnapshot(),
        whenIdle: () => queue.whenIdle(),
    };
}

export const processingService = createProcessingService();

export const requestProcessing = (resourceId, options) => processingService.requestProcessing(resourceId, options);
export const retryProcessing = (resourceId) => processingService.retryProcessing(resourceId);
export const cancelProcessing = (resourceId) => processingService.cancelProcessing(resourceId);
export const isProcessingBusy = (resourceId) => processingService.isBusy(resourceId);
export const assertNotProcessing = (resourceId) => processingService.assertNotProcessing(resourceId);
export const getLiveProcessingJob = (resourceId) => processingService.getLiveJob(resourceId);
export const getProcessingSnapshot = () => processingService.getSnapshot();
export const getProcessingQueue = () => processingService.queue;
export const recoverStaleProcessing = (options) => processingService.recoverStaleProcessing(options);

export { PROCESSING_REASONS, RETRY_LIMIT_CODE };
