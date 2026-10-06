/**
 * Local processing queue manager — Day 22.
 *
 * A browser-local, in-memory FIFO queue that sits ABOVE the unified
 * processing service. It is storage-agnostic: it receives a `runner`
 * function and executes it for each job. It is NOT a distributed or
 * background job system — queued work is lost if the tab is closed
 * (stale-job recovery in processingService handles the persisted side).
 *
 * Guarantees:
 *   - At most one live (queued or processing) job per resource.
 *   - Strict FIFO start order; auto-retries go to the back of the queue.
 *   - A bounded number of concurrent jobs (default 1: OCR/PDF are CPU heavy).
 *   - Bounded attempts per job (default 3) and no retry of permanent errors.
 *   - Queued jobs can be cancelled; active jobs cannot (no safe abort path
 *     in the PDF/OCR libraries), and the API says so instead of faking it.
 *   - `source-changed` requests during an active job schedule exactly one
 *     re-run after it, so stale results never silently stay current.
 *
 * Job model (plain, serializable):
 *   { id, resourceId, sourceType, status, attemptCount, maxAttempts, reason,
 *     createdAt, startedAt, completedAt, failedAt, errorCode, errorMessage,
 *     retryable, metadata }
 */

import { classifyFailure, getFailureMessage, RETRY_LIMIT_CODE } from './processingErrorPolicy.js';

export const PROCESSING_JOB_STATUS = Object.freeze({
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
});

export const PROCESSING_QUEUE_DEFAULTS = Object.freeze({
    maxConcurrent: 1,
    maxAttempts: 3,
    autoRetry: true,
    historyLimit: 50,
});

export const PROCESSING_REASONS = Object.freeze({
    REQUESTED: 'requested',
    SOURCE_CHANGED: 'source-changed',
    RETRY: 'retry',
});

let fallbackIdCounter = 0;

function defaultIdGenerator() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    fallbackIdCounter += 1;
    return 'job-' + Date.now().toString(36) + '-' + fallbackIdCounter;
}

function createDeferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function toSnapshot(job) {
    return {
        id: job.id,
        resourceId: job.resourceId,
        sourceType: job.sourceType,
        status: job.status,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        reason: job.reason,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        failedAt: job.failedAt,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        retryable: job.retryable,
        metadata: { ...job.metadata },
    };
}

export class ProcessingQueue {
    /**
     * @param {object} options
     * @param {(ctx: {resourceId: string, attemptNumber: number, job: object}) => Promise<unknown>} options.runner
     * @param {number} [options.maxConcurrent]
     * @param {number} [options.maxAttempts]
     * @param {boolean} [options.autoRetry]
     * @param {(event: {action: string, job: object, queue: object}) => void} [options.onEvent]
     * @param {() => Date|string} [options.clock]
     * @param {() => string} [options.idGenerator]
     * @param {number} [options.historyLimit]
     */
    constructor({
        runner,
        maxConcurrent = PROCESSING_QUEUE_DEFAULTS.maxConcurrent,
        maxAttempts = PROCESSING_QUEUE_DEFAULTS.maxAttempts,
        autoRetry = PROCESSING_QUEUE_DEFAULTS.autoRetry,
        onEvent = () => {},
        clock = () => new Date(),
        idGenerator = defaultIdGenerator,
        historyLimit = PROCESSING_QUEUE_DEFAULTS.historyLimit,
    } = {}) {
        if (typeof runner !== 'function') {
            throw new TypeError('ProcessingQueue requires a runner function.');
        }
        if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
            throw new RangeError('maxConcurrent must be a positive integer.');
        }
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            throw new RangeError('maxAttempts must be a positive integer.');
        }

        this.runner = runner;
        this.maxConcurrent = maxConcurrent;
        this.maxAttempts = maxAttempts;
        this.autoRetry = autoRetry;
        this.onEvent = onEvent;
        this.clock = clock;
        this.idGenerator = idGenerator;
        this.historyLimit = historyLimit;

        /** FIFO list of queued jobs (internal records). */
        this.waiting = [];
        /** resourceId → live job (queued or processing). */
        this.live = new Map();
        /** resourceId → most recent finished job snapshot (bounded). */
        this.history = new Map();
        this.pumpScheduled = false;
        this.idleWaiters = [];
    }

    /* ── Introspection ─────────────────────────────────────────── */

    /** @returns {'queued'|'processing'|null} */
    getState(resourceId) {
        return this.live.get(resourceId)?.status ?? null;
    }

    isBusy(resourceId) {
        return this.live.has(resourceId);
    }

    /** Latest known job (live first, then most recent finished). */
    getJob(resourceId) {
        const live = this.live.get(resourceId);
        if (live) return toSnapshot(live);
        return this.history.get(resourceId) ?? null;
    }

    getSnapshot() {
        const processing = [];
        for (const job of this.live.values()) {
            if (job.status === PROCESSING_JOB_STATUS.PROCESSING) processing.push(toSnapshot(job));
        }
        return {
            queued: this.waiting.map(toSnapshot),
            processing,
            queuedCount: this.waiting.length,
            processingCount: processing.length,
            maxConcurrent: this.maxConcurrent,
        };
    }

    /** Resolves when no jobs are queued or running. */
    whenIdle() {
        if (this.live.size === 0) return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.push(resolve));
    }

    /* ── Commands ──────────────────────────────────────────────── */

    /**
     * Request processing for a resource.
     *
     * - Resource already queued/processing → deduplicated (no second job).
     *   A `source-changed` request against a processing job schedules one
     *   re-run after the current attempt finishes.
     *
     * @param {string} resourceId
     * @param {object} [options]
     * @param {string} [options.sourceType]
     * @param {string} [options.reason]
     * @param {number} [options.attemptCount] — attempts already consumed
     * @param {object} [options.metadata]
     * @returns {{ accepted: boolean, deduplicated: boolean, job: object|null, completion: Promise<object|null>, reason?: string }}
     */
    enqueue(resourceId, {
        sourceType = null,
        reason = PROCESSING_REASONS.REQUESTED,
        attemptCount = 0,
        metadata = {},
    } = {}) {
        if (typeof resourceId !== 'string' || resourceId.trim() === '') {
            throw new TypeError('A resource id is required to enqueue processing.');
        }

        const existing = this.live.get(resourceId);
        if (existing) {
            if (reason === PROCESSING_REASONS.SOURCE_CHANGED) {
                existing.rerunRequested = true;
            }
            return {
                accepted: false,
                deduplicated: true,
                job: toSnapshot(existing),
                completion: existing.deferred.promise,
            };
        }

        const job = this.createJob(resourceId, { sourceType, reason, attemptCount, metadata });
        this.live.set(resourceId, job);
        this.waiting.push(job);
        this.emit(reason === PROCESSING_REASONS.RETRY ? 'retried' : 'queued', job);
        this.schedulePump();

        return { accepted: true, deduplicated: false, job: toSnapshot(job), completion: job.deferred.promise };
    }

    /**
     * Retry a failed (or interrupted) resource, honouring the attempt limit.
     *
     * @param {string} resourceId
     * @param {object} [options]
     * @param {number} [options.attemptCount] — failed attempts so far
     * @param {string} [options.sourceType]
     */
    retry(resourceId, { attemptCount = 0, sourceType = null, metadata = {} } = {}) {
        if (this.live.has(resourceId)) {
            return this.enqueue(resourceId, { sourceType, reason: PROCESSING_REASONS.RETRY });
        }
        if (attemptCount >= this.maxAttempts) {
            return {
                accepted: false,
                deduplicated: false,
                job: null,
                completion: Promise.resolve(null),
                reason: RETRY_LIMIT_CODE,
            };
        }
        return this.enqueue(resourceId, {
            sourceType,
            reason: PROCESSING_REASONS.RETRY,
            attemptCount,
            metadata,
        });
    }

    /**
     * Cancel a QUEUED job. Active jobs cannot be cancelled safely.
     *
     * @returns {{ cancelled: boolean, reason?: string }}
     */
    cancel(resourceId) {
        const job = this.live.get(resourceId);
        if (!job) return { cancelled: false, reason: 'NOT_QUEUED' };
        if (job.status === PROCESSING_JOB_STATUS.PROCESSING) {
            return { cancelled: false, reason: 'ACTIVE_CANCEL_UNSUPPORTED' };
        }

        this.waiting = this.waiting.filter((candidate) => candidate !== job);
        job.status = PROCESSING_JOB_STATUS.CANCELLED;
        job.completedAt = this.timestamp();
        this.live.delete(resourceId);
        this.remember(job);
        this.emit('cancelled', job);
        job.deferred.resolve(toSnapshot(job));
        this.notifyIdleIfNeeded();
        return { cancelled: true };
    }

    /* ── Internals ─────────────────────────────────────────────── */

    timestamp() {
        const value = this.clock();
        return value instanceof Date ? value.toISOString() : value;
    }

    createJob(resourceId, { sourceType, reason, attemptCount, metadata }) {
        return {
            id: this.idGenerator(),
            resourceId,
            sourceType,
            status: PROCESSING_JOB_STATUS.QUEUED,
            attemptCount,
            maxAttempts: this.maxAttempts,
            reason,
            createdAt: this.timestamp(),
            startedAt: null,
            completedAt: null,
            failedAt: null,
            errorCode: null,
            errorMessage: null,
            retryable: null,
            metadata: { ...metadata },
            rerunRequested: false,
            deferred: createDeferred(),
        };
    }

    emit(action, job) {
        try {
            this.onEvent({ action, job: toSnapshot(job), queue: this.getSnapshot() });
        } catch (error) {
            console.error('StudyLens processing event listener failed.', error);
        }
    }

    remember(job) {
        const snapshot = toSnapshot(job);
        this.history.delete(job.resourceId);
        this.history.set(job.resourceId, snapshot);
        while (this.history.size > this.historyLimit) {
            this.history.delete(this.history.keys().next().value);
        }
    }

    schedulePump() {
        if (this.pumpScheduled) return;
        this.pumpScheduled = true;
        Promise.resolve().then(() => {
            this.pumpScheduled = false;
            this.pump();
        });
    }

    pump() {
        while (this.processingCount() < this.maxConcurrent && this.waiting.length > 0) {
            const job = this.waiting.shift();
            void this.run(job);
        }
    }

    processingCount() {
        let count = 0;
        for (const job of this.live.values()) {
            if (job.status === PROCESSING_JOB_STATUS.PROCESSING) count += 1;
        }
        return count;
    }

    async run(job) {
        job.status = PROCESSING_JOB_STATUS.PROCESSING;
        job.attemptCount += 1;
        job.startedAt = this.timestamp();
        job.errorCode = null;
        job.errorMessage = null;
        job.retryable = null;
        this.emit('started', job);

        let failure = null;
        try {
            await this.runner({ resourceId: job.resourceId, attemptNumber: job.attemptCount, job: toSnapshot(job) });
        } catch (error) {
            failure = classifyFailure(error);
        }

        if (failure?.superseded) {
            /* The source changed mid-run: the attempt does not count. */
            job.attemptCount = Math.max(0, job.attemptCount - 1);
            job.rerunRequested = true;
            failure = null;
            this.finishWithRerun(job);
            return;
        }

        if (failure) {
            job.errorCode = failure.code;
            job.errorMessage = getFailureMessage(failure.code);
            job.retryable = failure.retryable;

            const canRetry = this.autoRetry
                && failure.retryable
                && !job.rerunRequested
                && job.attemptCount < job.maxAttempts;

            if (canRetry) {
                job.status = PROCESSING_JOB_STATUS.QUEUED;
                this.waiting.push(job);
                this.emit('retried', job);
                this.pump();
                return;
            }

            job.status = PROCESSING_JOB_STATUS.FAILED;
            job.failedAt = this.timestamp();
            job.completedAt = job.failedAt;
        } else {
            job.status = PROCESSING_JOB_STATUS.COMPLETED;
            job.completedAt = this.timestamp();
        }

        if (job.rerunRequested) {
            this.finishWithRerun(job);
            return;
        }

        this.finish(job);
    }

    finish(job) {
        this.live.delete(job.resourceId);
        this.remember(job);
        this.emit(job.status === PROCESSING_JOB_STATUS.COMPLETED ? 'completed' : 'failed', job);
        job.deferred.resolve(toSnapshot(job));
        this.pump();
        this.notifyIdleIfNeeded();
    }

    /**
     * The source changed during the run: discard this attempt's outcome and
     * queue exactly one fresh job (attempts reset). The original completion
     * promise adopts the re-run's completion.
     */
    finishWithRerun(job) {
        this.live.delete(job.resourceId);
        const next = this.createJob(job.resourceId, {
            sourceType: job.sourceType,
            reason: PROCESSING_REASONS.SOURCE_CHANGED,
            attemptCount: 0,
            metadata: job.metadata,
        });
        this.live.set(job.resourceId, next);
        this.waiting.push(next);
        job.status = PROCESSING_JOB_STATUS.CANCELLED;
        job.completedAt = this.timestamp();
        this.emit('queued', next);
        job.deferred.resolve(next.deferred.promise);
        this.pump();
    }

    notifyIdleIfNeeded() {
        if (this.live.size !== 0) return;
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        waiters.forEach((resolve) => resolve());
    }
}
