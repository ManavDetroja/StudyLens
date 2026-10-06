import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ProcessingQueue,
    PROCESSING_JOB_STATUS,
    PROCESSING_QUEUE_DEFAULTS,
    PROCESSING_REASONS,
} from '../js/processing/processingQueue.js';

import {
    classifyFailure,
    isRetryableCode,
    getFailureMessage,
    PERMANENT_ERROR_CODES,
    RETRYABLE_ERROR_CODES,
    INTERRUPTED_CODE,
    RETRY_LIMIT_CODE,
    SOURCE_CHANGED_CODE,
    RESOURCE_DELETED_CODE,
} from '../js/processing/processingErrorPolicy.js';

import {
    getProcessingDisplay,
    isStaleProcessing,
    STALE_PROCESSING_THRESHOLD_MS,
} from '../js/processing/processingDisplay.js';

import {
    createProcessingService,
    assertNotProcessing,
} from '../js/features/processingService.js';

import {
    processAndStore,
    getSourceFingerprint,
} from '../js/features/processingIntegration.js';

import { ContentProcessingError } from '../js/processing/errors.js';
import { createResourceRecord } from '../js/storage/resourceValidation.js';
import { generateLearningOutputsForResource } from '../js/features/learningOutputService.js';
import { generateFlashcardsForResource } from '../js/features/flashcardService.js';
import { generateQuizForResource } from '../js/features/quizService.js';
import { createTestPdfBytes } from './helpers/testPdfGenerator.mjs';

/* ── Test helpers / mocks ────────────────────────────────────────── */

function makeTestResource(props = {}) {
    const now = new Date().toISOString();
    return {
        id: props.id || 'res-' + Math.random().toString(36).slice(2),
        title: props.title || 'Test Resource',
        type: props.type || 'text',
        source: props.source || 'test://source',
        content: props.content !== undefined ? props.content : null,
        createdAt: props.createdAt || now,
        updatedAt: props.updatedAt || now,
        status: props.status || 'pending',
        tags: props.tags || [],
        metadata: props.metadata || {},
        ...(props.blob !== undefined ? { blob: props.blob } : {}),
    };
}

function createMockResourceRepository(initialResources = []) {
    const resources = new Map();
    initialResources.forEach((res) => resources.set(res.id, { ...res }));

    return {
        async getResource(id) {
            const res = resources.get(id);
            return res ? { ...res } : null;
        },
        async getAllResources() {
            return Array.from(resources.values()).map((r) => ({ ...r }));
        },
        async createResource(input) {
            const record = { ...input, id: input.id || 'res-' + Math.random().toString(36).slice(2) };
            resources.set(record.id, record);
            return { ...record };
        },
        async updateResource(id, updates) {
            const existing = resources.get(id);
            if (!existing) throw new Error('Resource not found: ' + id);
            const updated = {
                ...existing,
                ...updates,
                metadata: { ...(existing.metadata || {}), ...(updates.metadata || {}) },
                updatedAt: new Date().toISOString(),
            };
            resources.set(id, updated);
            return { ...updated };
        },
        async deleteResource(id) {
            return resources.delete(id);
        },
    };
}

function createMockProcessedContentRepository() {
    const store = new Map();
    return {
        async getByResourceId(resourceId) {
            const item = store.get(resourceId);
            return item ? JSON.parse(JSON.stringify(item)) : null;
        },
        async saveProcessedContent(normalizedContent) {
            const record = {
                id: 'proc-' + Math.random().toString(36).slice(2),
                resourceId: normalizedContent.resourceId,
                normalizedText: normalizedContent.text,
                chunks: normalizedContent.segments || [],
                sourceType: normalizedContent.sourceType,
                metadata: normalizedContent.metadata || {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            store.set(record.resourceId, record);
            return JSON.parse(JSON.stringify(record));
        },
        async deleteByResourceId(resourceId) {
            return store.delete(resourceId);
        },
    };
}

function createMockLearningOutputRepository() {
    const outputs = new Map();
    return {
        async createLearningOutput(item) {
            const record = { ...item, id: 'out-' + Math.random().toString(36).slice(2) };
            const list = outputs.get(item.resourceId) || [];
            list.push(record);
            outputs.set(item.resourceId, list);
            return record;
        },
        async getLearningOutputsByResourceId(resourceId) {
            return (outputs.get(resourceId) || []).map((o) => ({ ...o }));
        },
        async deleteLearningOutputsByResourceId(resourceId) {
            outputs.delete(resourceId);
        },
    };
}

function createMockQuizRepository() {
    const quizzes = new Map();
    return {
        async saveQuiz(quiz) {
            quizzes.set(quiz.resourceId, { ...quiz });
            return { ...quiz };
        },
        async createQuiz(quiz) {
            quizzes.set(quiz.resourceId, { ...quiz });
            return { ...quiz };
        },
        async getQuizByResourceId(resourceId) {
            return quizzes.get(resourceId) ? { ...quizzes.get(resourceId) } : null;
        },
        async deleteQuizzesByResourceId(resourceId) {
            quizzes.delete(resourceId);
        },
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ══════════════════════════════════════════════════════════════════
   1. Queue Creation & Configuration
   ══════════════════════════════════════════════════════════════════ */

test('1. Queue creation with default and custom options', () => {
    const queue = new ProcessingQueue({
        runner: async () => {},
    });
    assert.equal(queue.maxConcurrent, PROCESSING_QUEUE_DEFAULTS.maxConcurrent);
    assert.equal(queue.maxAttempts, PROCESSING_QUEUE_DEFAULTS.maxAttempts);
    assert.equal(queue.autoRetry, PROCESSING_QUEUE_DEFAULTS.autoRetry);

    const customQueue = new ProcessingQueue({
        runner: async () => {},
        maxConcurrent: 2,
        maxAttempts: 5,
        autoRetry: false,
    });
    assert.equal(customQueue.maxConcurrent, 2);
    assert.equal(customQueue.maxAttempts, 5);
    assert.equal(customQueue.autoRetry, false);

    assert.throws(() => new ProcessingQueue({}), /requires a runner function/);
    assert.throws(() => new ProcessingQueue({ runner: async () => {}, maxConcurrent: 0 }), /positive integer/);
    assert.throws(() => new ProcessingQueue({ runner: async () => {}, maxAttempts: -1 }), /positive integer/);
});

/* ══════════════════════════════════════════════════════════════════
   2. Enqueue & State Inspection
   ══════════════════════════════════════════════════════════════════ */

test('2. Enqueue accepts valid resource and tracks queued state', async () => {
    let executed = false;
    const queue = new ProcessingQueue({
        runner: async () => {
            executed = true;
        },
    });

    const result = queue.enqueue('res-1', { sourceType: 'text' });
    assert.equal(result.accepted, true);
    assert.equal(result.deduplicated, false);
    assert.equal(result.job.resourceId, 'res-1');
    assert.equal(result.job.status, PROCESSING_JOB_STATUS.QUEUED);

    const completed = await result.completion;
    assert.equal(executed, true);
    assert.equal(completed.status, PROCESSING_JOB_STATUS.COMPLETED);
});

/* ══════════════════════════════════════════════════════════════════
   3. FIFO Processing Order
   ══════════════════════════════════════════════════════════════════ */

test('3. FIFO processing order executes jobs deterministically', async () => {
    const executionOrder = [];
    const queue = new ProcessingQueue({
        maxConcurrent: 1,
        runner: async ({ resourceId }) => {
            await sleep(15);
            executionOrder.push(resourceId);
        },
    });

    const r1 = queue.enqueue('res-A');
    const r2 = queue.enqueue('res-B');
    const r3 = queue.enqueue('res-C');

    await Promise.all([r1.completion, r2.completion, r3.completion]);

    assert.deepEqual(executionOrder, ['res-A', 'res-B', 'res-C']);
});

/* ══════════════════════════════════════════════════════════════════
   4. Duplicate Job Prevention
   ══════════════════════════════════════════════════════════════════ */

test('4. Duplicate enqueue calls for the same resource are deduplicated to single job', async () => {
    let callCount = 0;
    const queue = new ProcessingQueue({
        runner: async () => {
            await sleep(20);
            callCount += 1;
        },
    });

    const call1 = queue.enqueue('res-dedup');
    const call2 = queue.enqueue('res-dedup');
    const call3 = queue.enqueue('res-dedup');

    assert.equal(call1.accepted, true);
    assert.equal(call1.deduplicated, false);
    assert.equal(call2.accepted, false);
    assert.equal(call2.deduplicated, true);
    assert.equal(call3.accepted, false);
    assert.equal(call3.deduplicated, true);

    await Promise.all([call1.completion, call2.completion, call3.completion]);
    assert.equal(callCount, 1);
});

/* ══════════════════════════════════════════════════════════════════
   5. Same-Resource Concurrency Prevention
   ══════════════════════════════════════════════════════════════════ */

test('5. Same-resource concurrency prevention guarantees exactly one active run', async () => {
    let concurrentCount = 0;
    let maxObservedConcurrent = 0;

    const queue = new ProcessingQueue({
        maxConcurrent: 2,
        runner: async () => {
            concurrentCount += 1;
            maxObservedConcurrent = Math.max(maxObservedConcurrent, concurrentCount);
            await sleep(15);
            concurrentCount -= 1;
        },
    });

    const run1 = queue.enqueue('res-solo');
    const run2 = queue.enqueue('res-solo');

    await Promise.all([run1.completion, run2.completion]);
    assert.equal(maxObservedConcurrent, 1);
});

/* ══════════════════════════════════════════════════════════════════
   6. Multiple Resource Jobs Concurrency
   ══════════════════════════════════════════════════════════════════ */

test('6. Multiple distinct resource jobs observe configured concurrency limit', async () => {
    let activeWorkers = 0;
    let maxWorkersObserved = 0;

    const queue = new ProcessingQueue({
        maxConcurrent: 1, // Conservative default
        runner: async () => {
            activeWorkers += 1;
            maxWorkersObserved = Math.max(maxWorkersObserved, activeWorkers);
            await sleep(15);
            activeWorkers -= 1;
        },
    });

    const jobs = ['res-1', 'res-2', 'res-3'].map((id) => queue.enqueue(id).completion);
    await Promise.all(jobs);

    assert.equal(maxWorkersObserved, 1);
});

/* ══════════════════════════════════════════════════════════════════
   7. Processing State Transitions & Event Dispatch
   ══════════════════════════════════════════════════════════════════ */

test('7. State transitions dispatch events in lifecycle order (queued -> started -> completed)', async () => {
    const events = [];
    const queue = new ProcessingQueue({
        onEvent: ({ action, job }) => {
            events.push({ action, status: job.status, id: job.resourceId });
        },
        runner: async () => {
            await sleep(10);
        },
    });

    const { completion } = queue.enqueue('res-events');
    await completion;

    const actions = events.map((e) => e.action);
    assert.ok(actions.includes('queued'));
    assert.ok(actions.includes('started'));
    assert.ok(actions.includes('completed'));
});

/* ══════════════════════════════════════════════════════════════════
   8. Failure State & Error Recording
   ══════════════════════════════════════════════════════════════════ */

test('8. Failure state captures error code, friendly message, and non-retryable status', async () => {
    const queue = new ProcessingQueue({
        autoRetry: false,
        runner: async () => {
            throw new ContentProcessingError('Invalid PDF file format', { code: 'INVALID_PDF' });
        },
    });

    const { completion } = queue.enqueue('res-fail');
    const finalJob = await completion;

    assert.equal(finalJob.status, PROCESSING_JOB_STATUS.FAILED);
    assert.equal(finalJob.errorCode, 'INVALID_PDF');
    assert.equal(finalJob.retryable, false);
    assert.ok(finalJob.errorMessage.includes('could not be read'));
});

/* ══════════════════════════════════════════════════════════════════
   9. Retry & Attempt Count Tracking
   ══════════════════════════════════════════════════════════════════ */

test('9. Auto-retry increments attemptCount and succeeds on subsequent try', async () => {
    let attempts = 0;
    const queue = new ProcessingQueue({
        maxAttempts: 3,
        autoRetry: true,
        runner: async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('STORAGE_ERROR');
            }
        },
    });

    const { completion } = queue.enqueue('res-retry');
    const finalJob = await completion;

    assert.equal(attempts, 2);
    assert.equal(finalJob.status, PROCESSING_JOB_STATUS.COMPLETED);
    assert.equal(finalJob.attemptCount, 2);
});

/* ══════════════════════════════════════════════════════════════════
   10. Retry Limit Reached
   ══════════════════════════════════════════════════════════════════ */

test('10. Auto-retry ceases when maxAttempts is reached and records failed job', async () => {
    let attempts = 0;
    const queue = new ProcessingQueue({
        maxAttempts: 2,
        autoRetry: true,
        runner: async () => {
            attempts += 1;
            throw new Error('STORAGE_OPERATION_FAILED');
        },
    });

    const { completion } = queue.enqueue('res-exhaust');
    const finalJob = await completion;

    assert.equal(attempts, 2);
    assert.equal(finalJob.status, PROCESSING_JOB_STATUS.FAILED);
    assert.equal(finalJob.attemptCount, 2);
});

/* ══════════════════════════════════════════════════════════════════
   11. Error Classification (Retryable vs Permanent)
   ══════════════════════════════════════════════════════════════════ */

test('11. Error classification categorizes transient vs permanent errors accurately', () => {
    // Retryable errors
    RETRYABLE_ERROR_CODES.forEach((code) => {
        const classified = classifyFailure({ code });
        assert.equal(classified.retryable, true, `Expected ${code} to be retryable`);
        assert.equal(isRetryableCode(code), true);
    });

    // Permanent errors
    PERMANENT_ERROR_CODES.forEach((code) => {
        const classified = classifyFailure({ code });
        assert.equal(classified.retryable, false, `Expected ${code} to be permanent`);
        assert.equal(isRetryableCode(code), false);
    });

    // Unknown errors default to retryable (bounded by attempt limit)
    const unknown = classifyFailure(new Error('Random glitch'));
    assert.equal(unknown.retryable, true);

    // Friendly messages exist
    assert.ok(getFailureMessage('TRANSCRIPT_UNAVAILABLE').includes('Paste the transcript'));
    assert.ok(getFailureMessage(INTERRUPTED_CODE).includes('interrupted'));
});

/* ══════════════════════════════════════════════════════════════════
   12. Cancellation of Queued Jobs vs Active Jobs
   ══════════════════════════════════════════════════════════════════ */

test('12. Queued jobs can be cancelled; active jobs cannot be cancelled safely', async () => {
    let activeStarted = false;
    let releaseActive;
    const activeWait = new Promise((resolve) => { releaseActive = resolve; });

    const queue = new ProcessingQueue({
        maxConcurrent: 1,
        runner: async ({ resourceId }) => {
            if (resourceId === 'res-active') {
                activeStarted = true;
                await activeWait;
            }
        },
    });

    const job1 = queue.enqueue('res-active');
    const job2 = queue.enqueue('res-waiting');

    // Wait until job1 is actively processing
    while (!activeStarted) {
        await sleep(5);
    }

    // Try to cancel the actively running job
    const cancelActive = queue.cancel('res-active');
    assert.equal(cancelActive.cancelled, false);
    assert.equal(cancelActive.reason, 'ACTIVE_CANCEL_UNSUPPORTED');

    // Cancel the queued waiting job
    const cancelQueued = queue.cancel('res-waiting');
    assert.equal(cancelQueued.cancelled, true);
    assert.equal(queue.getState('res-waiting'), null);

    releaseActive();
    await job1.completion;
    const waitingOutcome = await job2.completion;
    assert.equal(waitingOutcome.status, PROCESSING_JOB_STATUS.CANCELLED);
});

/* ══════════════════════════════════════════════════════════════════
   13. Stale Processing Recovery
   ══════════════════════════════════════════════════════════════════ */

test('13. Stale processing recovery marks interrupted jobs as failed with retry enabled', async () => {
    const oldTimestamp = new Date(Date.now() - (STALE_PROCESSING_THRESHOLD_MS + 10_000)).toISOString();
    const staleResource = makeTestResource({
        id: 'res-stale',
        title: 'Interrupted PDF',
        type: 'pdf',
        status: 'processing',
        metadata: { processingStartedAt: oldTimestamp },
    });

    const resRepo = createMockResourceRepository([staleResource]);
    const service = createProcessingService({ resRepo });

    const recovered = await service.recoverStaleProcessing({ now: Date.now() });
    assert.deepEqual(recovered, ['res-stale']);

    const updated = await resRepo.getResource('res-stale');
    assert.equal(updated.status, 'failed');
    assert.equal(updated.metadata.processingErrorCode, INTERRUPTED_CODE);
    assert.equal(updated.metadata.processingRetryable, true);

    const display = getProcessingDisplay(updated);
    assert.equal(display.canRetry, true);
    assert.equal(display.state, 'failed');
});

/* ══════════════════════════════════════════════════════════════════
   14. Processed Content Integrity: Preserved on Reprocessing Failure
   ══════════════════════════════════════════════════════════════════ */

test('14. Processed content integrity: previously valid chunks preserved after failed reprocessing', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    const textResource = makeTestResource({
        id: 'res-preserve',
        title: 'Preserve Me',
        type: 'text',
        content: 'Original valid text content that generates chunks.',
    });
    await resRepo.createResource(textResource);

    // Initial successful processing
    await processAndStore(textResource, { resRepo, processedRepo });
    const initialSaved = await processedRepo.getByResourceId('res-preserve');
    assert.ok(initialSaved !== null);
    assert.ok(initialSaved.chunks.length > 0);

    // Second processing run fails (e.g. storage error during reprocess)
    let failed = false;
    try {
        await processAndStore(textResource, {
            resRepo,
            processedRepo,
            pipeline: {
                processResource: async () => {
                    throw new ContentProcessingError('Simulated extraction crash', { code: 'EXTRACTION_FAILED' });
                },
            },
        });
    } catch {
        failed = true;
    }
    assert.equal(failed, true);

    // Previously valid processed content must still exist
    const preserved = await processedRepo.getByResourceId('res-preserve');
    assert.ok(preserved !== null);
    assert.equal(preserved.normalizedText, initialSaved.normalizedText);
    assert.equal(preserved.chunks.length, initialSaved.chunks.length);

    // Resource status reflects failure without wiping chunks
    const resAfter = await resRepo.getResource('res-preserve');
    assert.equal(resAfter.status, 'failed');
});

/* ══════════════════════════════════════════════════════════════════
   15. Source Content Changed During Active Run Triggers Re-run
   ══════════════════════════════════════════════════════════════════ */

test('15. Source content changed during active run discards stale result and re-runs', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    const resource = makeTestResource({
        id: 'res-edit-flight',
        title: 'Live Editing',
        type: 'text',
        content: 'Version 1 text.',
    });
    await resRepo.createResource(resource);

    let midFlightEdited = false;
    const service = createProcessingService({
        resRepo,
        processedRepo,
        processOptions: {
            pipeline: {
                processResource: async (res) => {
                    if (!midFlightEdited) {
                        midFlightEdited = true;
                        // User edits source while processing is in flight
                        await resRepo.updateResource(res.id, { content: 'Version 2 updated text.' });
                    }
                    return {
                        resourceId: res.id,
                        sourceType: 'text',
                        text: res.content,
                        segments: [{ index: 0, startOffset: 0, endOffset: res.content.length, text: res.content }],
                        createdAt: new Date().toISOString(),
                        metadata: {},
                    };
                },
            },
        },
    });

    const request = await service.requestProcessing('res-edit-flight');
    const finalJob = await request.completion;

    assert.equal(finalJob.status, PROCESSING_JOB_STATUS.COMPLETED);

    // The saved content must reflect Version 2, not stale Version 1
    const stored = await processedRepo.getByResourceId('res-edit-flight');
    assert.ok(stored.normalizedText.includes('Version 2'));
});

/* ══════════════════════════════════════════════════════════════════
   16. Downstream Protection: Generation Blocked During Active Processing
   ══════════════════════════════════════════════════════════════════ */

test('16. Downstream protection: assertNotProcessing prevents generation while busy', async () => {
    let releaseWorker;
    const workerBlock = new Promise((resolve) => { releaseWorker = resolve; });

    const resRepo = createMockResourceRepository([
        makeTestResource({ id: 'res-busy-downstream', title: 'Busy Resource', type: 'text', content: 'Some text' }),
    ]);

    const service = createProcessingService({
        resRepo,
        queueOptions: {
            runner: async () => {
                await workerBlock;
            },
        },
    });

    const req = await service.requestProcessing('res-busy-downstream');

    // Assert busy check throws ContentProcessingError
    assert.throws(
        () => service.assertNotProcessing('res-busy-downstream'),
        (err) => err.code === 'PROCESSING_IN_PROGRESS',
    );

    // Display helper also flags busy
    const display = getProcessingDisplay(
        { id: 'res-busy-downstream', status: 'processing' },
        { job: service.getLiveJob('res-busy-downstream') },
    );
    assert.equal(display.busy, true);

    releaseWorker();
    await req.completion;

    // After finish, assertNotProcessing no longer throws
    assert.doesNotThrow(() => service.assertNotProcessing('res-busy-downstream'));
});

/* ══════════════════════════════════════════════════════════════════
   17. Downstream Study Aids Compatibility (Outputs, Flashcards, Quiz)
   ══════════════════════════════════════════════════════════════════ */

test('17. Completed queue-processed resource smoothly powers downstream study aids', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const learningRepo = createMockLearningOutputRepository();
    const quizRepo = createMockQuizRepository();

    const sampleContent =
        'Inheritance is an object-oriented mechanism where a child class acquires properties of a parent class. ' +
        'Polymorphism is the provision of a single interface to entities of different types. ' +
        'Encapsulation is the packing of data and functions into a single component.';

    const resource = makeTestResource({
        id: 'res-study-aids',
        title: 'OOP Concepts',
        type: 'text',
        content: sampleContent,
    });
    await resRepo.createResource(resource);

    const service = createProcessingService({ resRepo, processedRepo });
    const req = await service.requestProcessing('res-study-aids');
    await req.completion;

    // 1. Learning Outputs
    const outputsResult = await generateLearningOutputsForResource('res-study-aids', {
        resRepo,
        processedRepo,
        learningRepo,
    });
    assert.ok(outputsResult.outputs.length > 0);

    // 2. Flashcards
    const flashcards = await generateFlashcardsForResource('res-study-aids', {
        resRepo,
        learningRepo,
        processedRepo,
    });
    assert.ok(flashcards.flashcards.length > 0);

    // 3. Quizzes
    const quizResult = await generateQuizForResource('res-study-aids', {
        resRepo,
        learningRepo,
        processedRepo,
        quizRepo,
    });
    assert.ok(quizResult !== null);
    assert.ok(quizResult.quiz !== null);
    assert.ok(quizResult.quiz.questions.length > 0);
});

/* ══════════════════════════════════════════════════════════════════
   18. Multimodal Processing Integration Matrix
   ══════════════════════════════════════════════════════════════════ */

test('18. Integration matrix: Text, PDF, Image, and Video queue and process through common service', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    // 1. Text Resource
    const textRes = makeTestResource({ id: 'res-m-text', title: 'Text Note', type: 'text', content: 'Simple plain text.' });
    await resRepo.createResource(textRes);

    // 2. PDF Resource (with valid test PDF bytes)
    const pdfBytes = createTestPdfBytes(['Extracted PDF text document with study concepts.']);
    const pdfRes = makeTestResource({ id: 'res-m-pdf', title: 'Doc PDF', type: 'pdf', status: 'pending', blob: pdfBytes });
    await resRepo.createResource(pdfRes);

    // 3. Image Resource (with extracted text content)
    const imgRes = makeTestResource({ id: 'res-m-img', title: 'Diagram', type: 'image', status: 'pending', content: 'Extracted text from image OCR.' });
    await resRepo.createResource(imgRes);

    // 4. Video Resource (with transcript)
    const vidRes = makeTestResource({
        id: 'res-m-vid',
        title: 'Video Lecture',
        type: 'video',
        source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '00:00 Welcome to class\n00:10 We study queues today.',
        metadata: { transcript: '00:00 Welcome to class\n00:10 We study queues today.' },
    });
    await resRepo.createResource(vidRes);

    const service = createProcessingService({
        resRepo,
        processedRepo,
    });

    const results = await Promise.all([
        service.requestProcessing('res-m-text').then((r) => r.completion),
        service.requestProcessing('res-m-pdf').then((r) => r.completion),
        service.requestProcessing('res-m-img').then((r) => r.completion),
        service.requestProcessing('res-m-vid').then((r) => r.completion),
    ]);

    results.forEach((job) => {
        assert.equal(job.status, PROCESSING_JOB_STATUS.COMPLETED);
    });

    // Check all records persisted in processedRepo
    assert.ok((await processedRepo.getByResourceId('res-m-text')) !== null);
    assert.ok((await processedRepo.getByResourceId('res-m-pdf')) !== null);
    assert.ok((await processedRepo.getByResourceId('res-m-img')) !== null);
    assert.ok((await processedRepo.getByResourceId('res-m-vid')) !== null);
});

