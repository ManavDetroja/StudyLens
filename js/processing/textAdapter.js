import { ContentProcessingError } from './errors.js';
import { normalizeTextContent } from './textNormalizer.js';

/**
 * The initial source-adapter implementation. Its shape is the contract that
 * future PDF, image, and video adapters will follow without inheritance.
 */
export const textAdapter = Object.freeze({
    id: 'text',

    canHandle(resource) {
        return resource?.type === 'text';
    },

    extract(resource) {
        if (!this.canHandle(resource)) {
            throw new ContentProcessingError('The text adapter only supports text resources.', {
                code: 'UNSUPPORTED_RESOURCE_TYPE',
            });
        }
        if (typeof resource.content !== 'string' || resource.content.trim() === '') {
            throw new ContentProcessingError('This text resource has no content to process.', {
                code: 'RESOURCE_CONTENT_MISSING',
            });
        }

        return resource.content;
    },

    normalize(extractedContent, resource) {
        const text = normalizeTextContent(extractedContent);
        if (text === '') {
            throw new ContentProcessingError('This text resource has no readable content to process.', {
                code: 'RESOURCE_CONTENT_MISSING',
            });
        }

        return {
            resourceId: resource.id,
            sourceType: resource.type,
            text,
            segments: [],
            // The output describes the resource snapshot at this timestamp.
            createdAt: resource.updatedAt,
            metadata: { adapterId: this.id },
        };
    },
});
