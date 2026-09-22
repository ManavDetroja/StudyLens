import { ContentProcessingError } from './errors.js';

export const DEFAULT_MAX_CHUNK_SIZE = 1200;

function getMaxChunkSize(options) {
    const maxChunkSize = options?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;

    if (!Number.isInteger(maxChunkSize) || maxChunkSize < 1) {
        throw new ContentProcessingError('maxChunkSize must be a positive integer.', {
            code: 'INVALID_CHUNK_SIZE',
        });
    }

    return maxChunkSize;
}

function findChunkEnd(content, startOffset, maxChunkSize) {
    const maximumEnd = Math.min(startOffset + maxChunkSize, content.length);
    if (maximumEnd === content.length) return maximumEnd;

    for (let endOffset = maximumEnd; endOffset > startOffset; endOffset -= 1) {
        if (content.slice(endOffset - 2, endOffset) === '\n\n') return endOffset;
    }

    for (let endOffset = maximumEnd; endOffset > startOffset; endOffset -= 1) {
        if (content[endOffset - 1] === '\n') return endOffset;
    }

    return maximumEnd;
}

/**
 * Split already-normalized text into contiguous segments. Paragraph boundaries
 * are preferred, then line boundaries, before falling back to a hard split.
 * Segment offsets make coverage and ordering explicit for future consumers.
 *
 * @param {string} content
 * @param {{ maxChunkSize?: number }} [options]
 * @returns {{ index: number, startOffset: number, endOffset: number, text: string }[]}
 */
export function chunkNormalizedContent(content, options = {}) {
    if (typeof content !== 'string') {
        throw new ContentProcessingError('Normalized content must be a string.', {
            code: 'INVALID_NORMALIZED_CONTENT',
        });
    }

    const maxChunkSize = getMaxChunkSize(options);
    if (content === '') return [];

    const segments = [];
    let startOffset = 0;

    while (startOffset < content.length) {
        const endOffset = findChunkEnd(content, startOffset, maxChunkSize);
        const text = content.slice(startOffset, endOffset);

        segments.push({
            index: segments.length,
            startOffset,
            endOffset,
            text,
        });
        startOffset = endOffset;
    }

    return segments;
}
