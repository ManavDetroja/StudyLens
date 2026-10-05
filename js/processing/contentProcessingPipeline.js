import { validateResource } from '../storage/resourceValidation.js';
import { chunkNormalizedContent } from './contentChunker.js';
import { ContentProcessingError, asContentProcessingError } from './errors.js';
import { textAdapter } from './textAdapter.js';
import { pdfAdapter } from './pdfAdapter.js';
import { imageAdapter } from './imageAdapter.js';
import {
    SourceAdapterRegistry,
    sourceAdapterRegistry,
    assertAdapterContract,
} from './sourceAdapterRegistry.js';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
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

export function enrichSegmentsWithPages(segments, pageOffsets) {
    if (!Array.isArray(pageOffsets) || pageOffsets.length === 0) {
        return segments;
    }

    return segments.map((seg) => {
        const matchingPages = pageOffsets.filter((p) =>
            seg.startOffset < p.endOffset && seg.endOffset > p.startOffset
        ).map((p) => p.pageNumber);

        const pages = matchingPages.length > 0 ? matchingPages : [pageOffsets[0].pageNumber];
        return {
            ...seg,
            pageNumber: pages[0],
            pages,
        };
    });
}

/**
 * Orchestrates validated, local-only extraction, normalization, and chunking.
 * It intentionally accepts a Resource object and returns data without changing
 * IndexedDB records or resource processing statuses.
 */
export class ContentProcessingPipeline {
    constructor({
        registry = null,
        adapters = null,
        chunker = chunkNormalizedContent,
    } = {}) {
        if (typeof chunker !== 'function') {
            throw new ContentProcessingError('The content chunker must be a function.', {
                code: 'INVALID_CHUNKER',
            });
        }
        this.chunker = chunker;

        if (adapters !== null) {
            if (!Array.isArray(adapters)) {
                throw new ContentProcessingError('Content adapters must be an array.', {
                    code: 'INVALID_ADAPTERS',
                });
            }
            adapters.forEach(assertAdapterContract);
            this.registry = new SourceAdapterRegistry(adapters);
        } else if (registry instanceof SourceAdapterRegistry) {
            this.registry = registry;
        } else {
            this.registry = sourceAdapterRegistry;
        }
    }

    get adapters() {
        return this.registry.getAllAdapters();
    }

    findAdapter(resource) {
        return this.registry.findAdapter(resource);
    }

    async processResource(resource, { chunking, ...options } = {}) {
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
            () => adapter.extract(resource, options),
            'StudyLens could not extract content from this resource.',
            'EXTRACTION_FAILED',
        );
        const normalizedContent = await runProcessingStep(
            () => adapter.normalize(extractedContent, resource, options),
            'StudyLens could not normalize this resource.',
            'NORMALIZATION_FAILED',
        );
        assertNormalizedContent(normalizedContent, resource);

        const rawSegments = await runProcessingStep(
            () => this.chunker(normalizedContent.text, chunking),
            'StudyLens could not split this resource into segments.',
            'CHUNKING_FAILED',
        );

        const segments = enrichSegmentsWithPages(rawSegments, normalizedContent.metadata?.pageOffsets);

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
