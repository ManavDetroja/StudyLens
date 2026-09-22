import { ContentProcessingError } from './errors.js';

/**
 * Produce stable, readable plain text while retaining paragraph and line
 * boundaries. This function has no resource or storage dependency so future
 * adapters can share it.
 *
 * @param {string} content
 * @returns {string}
 */
export function normalizeTextContent(content) {
    if (typeof content !== 'string') {
        throw new ContentProcessingError('Text content must be a string.', {
            code: 'INVALID_TEXT_CONTENT',
        });
    }

    const normalizedLines = content
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trimEnd());

    return normalizedLines
        .join('\n')
        .replace(/\n[ ]*\n(?:[ ]*\n)*/g, '\n\n')
        .split('\n\n')
        .map((paragraph) => paragraph.trim())
        .join('\n\n')
        .trim();
}
