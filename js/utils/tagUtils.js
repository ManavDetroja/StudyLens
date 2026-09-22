/**
 * Tag normalization, validation, and extraction utilities — Day 6.
 *
 * Provides a single reusable module for all tag operations. Every feature
 * that creates, updates, or filters by tag should use these functions to
 * ensure consistent behavior.
 *
 * Tags are stored as lowercase, trimmed, deduplicated strings.
 */

import { ResourceValidationError } from '../storage/errors.js';

/** Maximum number of tags allowed on a single resource. */
export const MAX_TAGS_PER_RESOURCE = 20;

/** Maximum character length of an individual tag. */
export const MAX_TAG_LENGTH = 50;

/**
 * Normalize a raw comma-separated tag string into a clean array.
 *
 * 1. Split on commas.
 * 2. Trim whitespace from each tag.
 * 3. Lowercase for consistent matching and display.
 * 4. Remove empty strings.
 * 5. Deduplicate (first occurrence wins).
 *
 * @param {string} rawTags — comma-separated tag string from user input
 * @returns {string[]} — normalized tag array
 */
export function normalizeTags(rawTags) {
    if (typeof rawTags !== 'string') return [];

    return [...new Set(
        rawTags
            .split(',')
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
    )];
}

/**
 * Normalize an existing tag array (e.g. from a stored resource).
 * Lowercases, trims, removes empties, and deduplicates.
 *
 * @param {string[]} tags
 * @returns {string[]}
 */
export function normalizeTagArray(tags) {
    if (!Array.isArray(tags)) return [];

    return [...new Set(
        tags
            .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
            .filter(Boolean),
    )];
}

/**
 * Validate a normalized tag array against length and count limits.
 * Throws ResourceValidationError with a descriptive code on failure.
 *
 * @param {string[]} tags — already-normalized tag array
 * @throws {ResourceValidationError}
 */
export function validateTags(tags) {
    if (!Array.isArray(tags)) {
        throw new ResourceValidationError('Tags must be an array.', {
            code: 'TAGS_INVALID_TYPE',
        });
    }

    if (tags.length > MAX_TAGS_PER_RESOURCE) {
        throw new ResourceValidationError(
            'A resource can have at most ' + MAX_TAGS_PER_RESOURCE + ' tags.',
            { code: 'TAGS_TOO_MANY' },
        );
    }

    for (const tag of tags) {
        if (typeof tag !== 'string' || tag.trim() === '') {
            throw new ResourceValidationError('Each tag must be a non-empty string.', {
                code: 'TAG_EMPTY',
            });
        }
        if (tag.length > MAX_TAG_LENGTH) {
            throw new ResourceValidationError(
                'Each tag must be ' + MAX_TAG_LENGTH + ' characters or fewer.',
                { code: 'TAG_TOO_LONG' },
            );
        }
    }
}

/**
 * Collect all unique tags from a set of resources, sorted alphabetically.
 * Useful for populating a tag-filter dropdown from actual data.
 *
 * @param {object[]} resources
 * @returns {string[]} — sorted, deduplicated tag list
 */
export function collectAllTags(resources) {
    const tagSet = new Set();

    for (const resource of resources) {
        if (Array.isArray(resource.tags)) {
            for (const tag of resource.tags) {
                if (typeof tag === 'string' && tag.trim()) {
                    tagSet.add(tag.trim().toLowerCase());
                }
            }
        }
    }

    return [...tagSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
