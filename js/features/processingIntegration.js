/**
 * Text resource processing integration — Day 8.
 *
 * Bridges the Day 7 in-memory processing pipeline with persistent storage.
 * Provides a high-level API for feature modules to process, retrieve, and
 * clean up processed content without directly touching IndexedDB or the
 * processing pipeline internals.
 *
 * Flow:
 *   Resource → processResource() → Pipeline → ProcessedContentRepository → IndexedDB
 */

import { processResource } from '../processing/contentProcessingPipeline.js';
import { ContentProcessingError, asContentProcessingError } from '../processing/errors.js';
import { processedContentRepository } from '../storage/processedContentStore.js';
import { resourceRepository } from '../storage/resourceStore.js';

/**
 * Process a resource through the Day 7 pipeline and persist the result.
 * Invalidates and removes any stale processed content for the same resourceId
 * before storing the new processed result.
 *
 * @param {object} resource — a full Resource record from IndexedDB
 * @param {object} [options]
 * @param {object} [options.processedRepo] — custom ProcessedContentRepository instance
 * @param {object} [options.resRepo] — custom ResourceRepository instance
 * @returns {Promise<object>} — the persisted ProcessedContent record
 * @throws {ContentProcessingError} if the pipeline rejects the resource
 */
export async function processAndStore(resource, {
    processedRepo = processedContentRepository,
    resRepo = resourceRepository,
} = {}) {
    if (!resource || typeof resource.id !== 'string' || resource.id.trim() === '') {
        throw new ContentProcessingError('A valid resource with an id is required for processing.', {
            code: 'PROCESSING_INVALID_RESOURCE',
        });
    }

    // Invalidate/remove stale processed content immediately so it cannot be returned
    try {
        await processedRepo.deleteByResourceId(resource.id);
    } catch {
        // Non-fatal if no prior processed content existed
    }

    try {
        const normalizedContent = await processResource(resource);
        const saved = await processedRepo.saveProcessedContent(normalizedContent);

        // If resource had a pending status, update to completed
        if (resource.status === 'pending' && resRepo) {
            try {
                await resRepo.updateResource(resource.id, { status: 'completed' });
            } catch {
                // Non-fatal status update
            }
        }

        return saved;
    } catch (error) {
        // Record failure on the resource without losing original data
        if (resRepo) {
            try {
                await resRepo.updateResource(resource.id, {
                    status: 'failed',
                    metadata: {
                        ...(resource.metadata || {}),
                        processingError: error.message,
                        processingErrorCode: error.code || 'PROCESSING_FAILED',
                    },
                });
            } catch {
                // Secondary error ignored
            }
        }
        throw asContentProcessingError(error, error.message || 'StudyLens could not process this resource.');
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
} = {}) {
    const resource = await resRepo.getResource(resourceId);
    if (!resource) {
        throw new ContentProcessingError('Resource not found: ' + resourceId, {
            code: 'RESOURCE_NOT_FOUND',
        });
    }
    return processAndStore(resource, { resRepo, processedRepo });
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
 * Check whether a processing error is an expected, non-fatal condition
 * (e.g. unsupported resource type) vs an unexpected failure.
 *
 * @param {Error} error
 * @returns {boolean}
 */
export function isProcessingError(error) {
    return error instanceof ContentProcessingError;
}

