import { validateResource } from '../storage/resourceValidation.js';
import { chunkNormalizedContent } from './contentChunker.js';
import { ContentProcessingError, asContentProcessingError } from './errors.js';
import { textAdapter } from './textAdapter.js';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertAdapter(adapter) {
    if (!isPlainObject(adapter)
        || typeof adapter.id !== 'string'
        || adapter.id.trim() === ''
        || typeof adapter.canHandle !== 'function'
        || typeof adapter.extract !== 'function'
        || typeof adapter.normalize !== 'function') {
        throw new ContentProcessingError('A content adapter must provide id, canHandle, extract, and normalize methods.', {
            code: 'INVALID_ADAPTER',
        });
    }
}

function assertNormalizedContent(content, resource) {
    if (!isPlainObject(content)
        || content.resourceId !== resource.id
        || content.sourceType !== resource.type
        || typeof content.text !== 'string'
        || content.text === ''
        || !Array.isArray(content.segments)
        || typeof content.createdAt !== 'string'
        || !isPlainObject(content.metadata)) {
        throw new ContentProcessingError('An adapter returned invalid normalized content.', {
            code: 'INVALID_NORMALIZED_CONTENT',
        });
    }
}

async function runProcessingStep(step, message, code) {
    try {
        return await step();
    } catch (error) {
        throw asContentProcessingError(error, message, code);
    }
}

/**
 * Orchestrates validated, local-only extraction, normalization, and chunking.
 * It intentionally accepts a Resource object and returns data without changing
 * IndexedDB records or resource processing statuses.
 */
export class ContentProcessingPipeline {
    constructor({
        adapters = [textAdapter],
        chunker = chunkNormalizedContent,
    } = {}) {
        if (!Array.isArray(adapters)) {
            throw new ContentProcessingError('Content adapters must be an array.', {
                code: 'INVALID_ADAPTERS',
            });
        }
        adapters.forEach(assertAdapter);
        if (typeof chunker !== 'function') {
            throw new ContentProcessingError('The content chunker must be a function.', {
                code: 'INVALID_CHUNKER',
            });
        }

        this.adapters = [...adapters];
        this.chunker = chunker;
    }

    findAdapter(resource) {
        return this.adapters.find((adapter) => adapter.canHandle(resource)) ?? null;
    }

    async processResource(resource, { chunking } = {}) {
        try {
            validateResource(resource);
        } catch (error) {
            throw asContentProcessingError(
                error,
                'StudyLens cannot process an invalid resource.',
                'PROCESSING_INVALID_RESOURCE',
            );
        }

        const adapter = this.findAdapter(resource);
        if (!adapter) {
            throw new ContentProcessingError(
                'No content adapter is available for ' + resource.type + ' resources.',
                { code: 'UNSUPPORTED_RESOURCE_TYPE' },
            );
        }

        const extractedContent = await runProcessingStep(
            () => adapter.extract(resource),
            'StudyLens could not extract content from this resource.',
            'EXTRACTION_FAILED',
        );
        const normalizedContent = await runProcessingStep(
            () => adapter.normalize(extractedContent, resource),
            'StudyLens could not normalize this resource.',
            'NORMALIZATION_FAILED',
        );
        assertNormalizedContent(normalizedContent, resource);

        const segments = await runProcessingStep(
            () => this.chunker(normalizedContent.text, chunking),
            'StudyLens could not split this resource into segments.',
            'CHUNKING_FAILED',
        );

        return {
            ...normalizedContent,
            segments,
        };
    }
}

export const contentProcessingPipeline = new ContentProcessingPipeline();

export function processResource(resource, options) {
    return contentProcessingPipeline.processResource(resource, options);
}
