/**
 * Video Source Adapter — Day 21.
 *
 * Implements the SourceAdapter contract for video learning materials (YouTube):
 * 1. canHandle(resource) -> true if resource.type === 'video'
 * 2. extract(resource, options) -> acquires transcript via TranscriptProvider
 * 3. normalize(extractedContent, resource, options) -> normalizes text
 *    deterministically and builds the normalized content model.
 */

import { ContentProcessingError } from './errors.js';
import { normalizeTextContent } from './textNormalizer.js';
import { defaultTranscriptProvider } from './transcriptProvider.js';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export const videoAdapter = Object.freeze({
    id: 'video',

    canHandle(resource) {
        return Boolean(resource && resource.type === 'video');
    },

    async extract(resource, options = {}) {
        if (!this.canHandle(resource)) {
            throw new ContentProcessingError('The video adapter only supports video resources.', {
                code: 'UNSUPPORTED_RESOURCE_TYPE',
            });
        }

        const provider = options.transcriptProvider ?? defaultTranscriptProvider;
        const result = await provider.acquireTranscript(resource, options);

        if (!result.success) {
            throw new ContentProcessingError(
                result.reason || 'Transcript is unavailable for this video.',
                { code: result.code || 'TRANSCRIPT_UNAVAILABLE' }
            );
        }

        if (typeof result.text !== 'string' || result.text.trim() === '') {
            throw new ContentProcessingError('Extracted transcript contains no readable text.', {
                code: 'RESOURCE_CONTENT_MISSING',
            });
        }

        return {
            text: result.text,
            rawText: result.rawText,
            hasTimestamps: Boolean(result.hasTimestamps),
            transcriptSegments: result.segments || [],
            metadata: {
                provider: resource.metadata?.provider || 'youtube',
                videoId: resource.metadata?.videoId,
                canonicalUrl: resource.metadata?.canonicalUrl || resource.source,
                originalUrl: resource.metadata?.originalUrl,
                ...(isPlainObject(result.metadata) ? result.metadata : {}),
            },
        };
    },

    normalize(extractedContent, resource) {
        if (!extractedContent) {
            throw new ContentProcessingError('Invalid extracted video content.', {
                code: 'INVALID_EXTRACTED_CONTENT',
            });
        }

        const rawText = typeof extractedContent === 'string'
            ? extractedContent
            : extractedContent.text;

        if (typeof rawText !== 'string' || rawText.trim() === '') {
            throw new ContentProcessingError('This video resource has no transcript content to process.', {
                code: 'RESOURCE_CONTENT_MISSING',
            });
        }

        const normalizedText = normalizeTextContent(rawText);
        if (normalizedText === '') {
            throw new ContentProcessingError('This video resource has no readable transcript content to process.', {
                code: 'RESOURCE_CONTENT_MISSING',
            });
        }

        const extractedMeta = isPlainObject(extractedContent) && isPlainObject(extractedContent.metadata)
            ? extractedContent.metadata
            : {};

        return {
            resourceId: resource.id,
            sourceType: resource.type,
            text: normalizedText,
            segments: [],
            createdAt: resource.updatedAt || new Date().toISOString(),
            metadata: {
                adapterId: this.id,
                provider: resource.metadata?.provider || 'youtube',
                videoId: resource.metadata?.videoId,
                hasTimestamps: extractedContent.hasTimestamps ?? false,
                transcriptSegments: extractedContent.transcriptSegments ?? [],
                ...extractedMeta,
            },
        };
    },
});
