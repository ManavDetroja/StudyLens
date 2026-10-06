/**
 * Unified Content Processing Orchestrator — Day 20.
 *
 * Coordinates validated multimodal content extraction, normalization, chunking,
 * and durable persistence across Text, PDF, and Image resources.
 *
 * Lifecycle:
 *   Resource (pending/failed)
 *      ↓ [processAndStore]
 *   Status: 'processing'
 *      ↓
 *   SourceAdapter (via SourceAdapterRegistry)
 *      ↓ [extract]
 *   Extracted Content
 *      ↓ [normalize]
 *   Normalized Content
 *      ↓ [chunker]
 *   Segmented Content
 *      ↓ [processedContentRepo]
 *   IndexedDB (processedContent store; atomic replace, old result kept on failure)
 *      ↓
 *   Status: 'completed' (or 'failed' on error with metadata)
 *
 * Day 22: callers normally reach this through the local ProcessingQueue
 * (see processingService.js), which adds FIFO ordering, de-duplication,
 * bounded concurrency, and retry on top of this single-run orchestrator.
 */

import { processResource } from '../processing/contentProcessingPipeline.js';
import { ContentProcessingError, asContentProcessingError } from '../processing/errors.js';
import { processedContentRepository } from '../storage/processedContentStore.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { notifyResourcesChanged } from '../core/resourceEvents.js';
import {
    classifyFailure,
    getFailureMessage,
    SOURCE_CHANGED_CODE,
    RESOURCE_DELETED_CODE,
} from '../processing/processingErrorPolicy.js';

export const PROCESSING_ERROR_CODES = Object.freeze({
    UNSUPPORTED_SOURCE: 'UNSUPPORTED_RESOURCE_TYPE',
    EXTRACTION_FAILED: 'EXTRACTION_FAILED',
    NORMALIZATION_FAILED: 'NORMALIZATION_FAILED',
    CHUNKING_FAILED: 'CHUNKING_FAILED',
    PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
    MISSING_SOURCE: 'RESOURCE_CONTENT_MISSING',
    MISSING_BLOB: 'FILE_BLOB_MISSING',
    PROCESSING_ALREADY_IN_PROGRESS: 'PROCESSING_ALREADY_IN_PROGRESS',
});

/**
 * In-memory concurrency locks per resource ID to prevent race conditions
 * from duplicate trigger events.
 * @type {Set<string>}
 */
const activeProcessingLocks = new Set();

/**
 * Check if a resource is currently undergoing processing.
 * @param {string} resourceId
 * @returns {boolean}
 */
export function isResourceProcessing(resourceId) {
    if (typeof resourceId !== 'string') return false;
    return activeProcessingLocks.has(resourceId);
}

/**
 * Get an array of all currently active processing resource IDs.
 * @returns {string[]}
 */
export function getActiveProcessingIds() {
    return Array.from(activeProcessingLocks);
}

/**
 * Classify any error into a canonical processing error code.
 * @param {Error|unknown} error
 * @returns {string}
 */
export function classifyProcessingError(error) {
    if (!error) return 'PROCESSING_FAILED';
    const code = error.code || '';
    if (code === 'UNSUPPORTED_RESOURCE_TYPE' || code === 'UNSUPPORTED_SOURCE') {
        return PROCESSING_ERROR_CODES.UNSUPPORTED_SOURCE;
    }
    if (code === 'RESOURCE_CONTENT_MISSING' || code === 'MISSING_SOURCE') {
        return PROCESSING_ERROR_CODES.MISSING_SOURCE;
    }
    if (code === 'FILE_BLOB_MISSING' || code === 'MISSING_BLOB') {
        return PROCESSING_ERROR_CODES.MISSING_BLOB;
    }
    if (code === 'PROCESSING_ALREADY_IN_PROGRESS') {
        return PROCESSING_ERROR_CODES.PROCESSING_ALREADY_IN_PROGRESS;
    }
    if (code === 'EXTRACTION_FAILED' || code === 'NO_SELECTABLE_TEXT' || code === 'NO_EXTRACTED_TEXT' || code === 'INVALID_PDF') {
        return PROCESSING_ERROR_CODES.EXTRACTION_FAILED;
    }
    if (code === 'NORMALIZATION_FAILED' || code === 'INVALID_NORMALIZED_CONTENT') {
        return PROCESSING_ERROR_CODES.NORMALIZATION_FAILED;
    }
    if (code === 'CHUNKING_FAILED') {
        return PROCESSING_ERROR_CODES.CHUNKING_FAILED;
    }
    if (code === 'PERSISTENCE_FAILED' || code === 'STORAGE_ERROR') {
        return PROCESSING_ERROR_CODES.PERSISTENCE_FAILED;
    }
    return code || 'PROCESSING_FAILED';
}

/**
 * Stable fingerprint of the user-controlled source of a resource. Used to
 * detect that the source changed while a processing run was in flight.
 * Processing-written fields (status, normalized content for file sources)
 * are deliberately excluded or compared before they are written.
 */
export function getSourceFingerprint(resource) {
    return JSON.stringify([
        resource?.type ?? null,
        resource?.source ?? null,
        resource?.content ?? null,
        resource?.metadata?.transcript ?? null,
    ]);
}

/** Metadata keys written by the processing lifecycle (cleared on success). */
const PROCESSING_METADATA_KEYS = Object.freeze([
    'processingError',
    'processingErrorCode',
    'processingRetryable',
    'processingFailedAt',
    'processingStartedAt',
    'processingAttempts',
]);

/**
 * Read the freshest stored copy of a resource.
 * @returns {Promise<object|null|undefined>} resource; null if deleted; undefined if unknown
 */
async function readLatestResource(resRepo, resourceId) {
    if (!resRepo || typeof resRepo.getResource !== 'function') return undefined;
    try {
        return (await resRepo.getResource(resourceId)) ?? null;
    } catch {
        return undefined;
    }
}

/**
 * Process a resource through the unified processing orchestrator and persist the result.
 *
 * Data-integrity rules (Day 22):
 *   - A previously valid processed record is NEVER deleted up front. The new
 *     result replaces it atomically (ProcessedContentRepository.saveProcessedContent
 *     removes/adds inside one transaction), so a failed run leaves the old
 *     result intact.
 *   - If the resource is deleted or its source changes while processing, the
 *     new result is discarded instead of being persisted as current.
 *   - Processing metadata is merged into the LATEST stored metadata, never
 *     the snapshot taken when the run began.
 *
 * Enforces per-resource concurrency locking as a last line of defence; the
 * ProcessingQueue is the normal entry point.
 *
 * @param {object} resource — a full Resource record
 * @param {object} [options]
 * @param {object} [options.processedRepo] — custom ProcessedContentRepository instance
 * @param {object} [options.resRepo] — custom ResourceRepository instance
 * @param {number} [options.attemptNumber] — 1-based attempt number from the queue
 * @returns {Promise<object>} — the persisted ProcessedContent record
 * @throws {ContentProcessingError}
 */
export async function processAndStore(resource, {
    processedRepo = processedContentRepository,
    resRepo = resourceRepository,
    attemptNumber,
    ...options
} = {}) {
    if (!resource || typeof resource.id !== 'string' || resource.id.trim() === '') {
        throw new ContentProcessingError('A valid resource with an id is required for processing.', {
            code: 'PROCESSING_INVALID_RESOURCE',
        });
    }

    const resourceId = resource.id;

    // 1. Concurrency guard: reject concurrent runs on the same resource
    if (activeProcessingLocks.has(resourceId)) {
        throw new ContentProcessingError(
            `Processing is already in progress for resource "${resourceId}".`,
            { code: PROCESSING_ERROR_CODES.PROCESSING_ALREADY_IN_PROGRESS }
        );
    }

    activeProcessingLocks.add(resourceId);

    try {
        const initialStored = await readLatestResource(resRepo, resourceId);
        const wasStoredAtStart = Boolean(initialStored);
        const baselineStoredFingerprint = getSourceFingerprint(initialStored ?? resource);

        // 2. Transition status to 'processing' and record the attempt.
        //    Existing processed content is left untouched.
        if (resRepo) {
            try {
                const latest = initialStored ?? resource;
                const meta = { ...(latest.metadata || {}) };
                PROCESSING_METADATA_KEYS.forEach((key) => delete meta[key]);
                meta.processingStartedAt = new Date().toISOString();
                meta.processingAttempts = Number.isInteger(attemptNumber)
                    ? attemptNumber
                    : (Number(latest.metadata?.processingAttempts) || 0) + 1;

                await resRepo.updateResource(resourceId, { status: 'processing', metadata: meta });
                notifyResourcesChanged({ action: 'updated', resourceId });
            } catch {
                // Non-fatal status update
            }
        }

        // 3. Run through content processing pipeline
        const normalizedContent = await processResource(resource, options);

        // 4. Integrity check: was the resource deleted or its source changed meanwhile?
        const beforeSave = await readLatestResource(resRepo, resourceId);
        if (wasStoredAtStart && beforeSave === null) {
            throw new ContentProcessingError('The resource was deleted while it was being processed.', {
                code: RESOURCE_DELETED_CODE,
            });
        }
        if (wasStoredAtStart && beforeSave && getSourceFingerprint(beforeSave) !== baselineStoredFingerprint) {
            throw new ContentProcessingError('The resource changed while it was being processed.', {
                code: SOURCE_CHANGED_CODE,
            });
        }

        // 5. Persist the segmented chunks (atomic replace of any previous record)
        let saved;
        try {
            saved = await processedRepo.saveProcessedContent(normalizedContent);
        } catch (storageErr) {
            throw asContentProcessingError(
                storageErr,
                'Failed to persist processed content to storage.',
                PROCESSING_ERROR_CODES.PERSISTENCE_FAILED
            );
        }

        // 6. Update resource with 'completed' status and synchronized extracted text content
        if (resRepo) {
            try {
                const latest = await readLatestResource(resRepo, resourceId);
                if (wasStoredAtStart && latest === null) {
                    // Deleted after the integrity check: do not leave an orphan record.
                    await processedRepo.deleteByResourceId(resourceId).catch(() => undefined);
                    return saved;
                }
                const meta = { ...((latest ?? resource).metadata || {}) };
                PROCESSING_METADATA_KEYS.forEach((key) => delete meta[key]);

                await resRepo.updateResource(resourceId, {
                    status: 'completed',
                    content: normalizedContent.text,
                    metadata: meta,
                });
                notifyResourcesChanged({ action: 'updated', resourceId });
            } catch {
                // Non-fatal status update
            }
        }

        return saved;
    } catch (error) {
        // 7. On error: record failure on resource while preserving all original data
        //    (and any previously valid processed content).
        const errorCode = error.code || classifyProcessingError(error);
        const superseded = errorCode === SOURCE_CHANGED_CODE || errorCode === RESOURCE_DELETED_CODE;

        if (resRepo && !superseded) {
            try {
                const latest = (await readLatestResource(resRepo, resourceId)) ?? resource;
                const failure = classifyFailure(error);
                const meta = { ...(latest.metadata || {}) };
                meta.processingError = getFailureMessage(failure.code);
                meta.processingErrorCode = failure.code;
                meta.processingRetryable = failure.retryable;
                meta.processingFailedAt = new Date().toISOString();
                delete meta.processingStartedAt;

                await resRepo.updateResource(resourceId, { status: 'failed', metadata: meta });
                notifyResourcesChanged({ action: 'updated', resourceId });
            } catch {
                // Secondary error ignored
            }
        }

        throw asContentProcessingError(
            error,
            error.message || 'StudyLens could not process this resource.',
            errorCode
        );
    } finally {
        // 8. Always release the in-memory concurrency lock
        activeProcessingLocks.delete(resourceId);
    }
}

/**
 * Process a stored resource by its id.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function processResourceById(resourceId, {
    resRepo = resourceRepository,
    processedRepo = processedContentRepository,
    ...options
} = {}) {
    const resource = await resRepo.getResource(resourceId);
    if (!resource) {
        throw new ContentProcessingError('Resource not found: ' + resourceId, {
            code: 'RESOURCE_NOT_FOUND',
        });
    }

    return processAndStore(resource, { resRepo, processedRepo, ...options });
}

/**
 * Retrieve processed content for a resource.
 *
 * @param {string} resourceId
 * @param {object} [processedRepo]
 * @returns {Promise<object|null>}
 */
export function getProcessedContent(resourceId, processedRepo = processedContentRepository) {
    return processedRepo.getByResourceId(resourceId);
}

/**
 * Delete processed content for a resource (e.g. on resource deletion).
 *
 * @param {string} resourceId
 * @param {object} [processedRepo]
 * @returns {Promise<boolean>}
 */
export function deleteProcessedContent(resourceId, processedRepo = processedContentRepository) {
    return processedRepo.deleteByResourceId(resourceId);
}

/**
 * Check whether an error is a recognized ContentProcessingError.
 *
 * @param {Error} error
 * @returns {boolean}
 */
export function isProcessingError(error) {
    return error instanceof ContentProcessingError;
}
