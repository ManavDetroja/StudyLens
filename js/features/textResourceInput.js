import { ResourceValidationError } from '../storage/errors.js';
import { normalizeTags, validateTags } from '../utils/tagUtils.js';

export const TEXT_RESOURCE_TITLE_MAX_LENGTH = 160;
export const TEXT_RESOURCE_CONTENT_MAX_LENGTH = 50000;

/**
 * @deprecated Use normalizeTags from js/utils/tagUtils.js directly.
 * Kept for backward compatibility with existing tests.
 */
export function normalizeTextResourceTags(rawTags) {
    return normalizeTags(rawTags);
}

export function validateTextResourceInput({ title, content, tags }) {
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedContent = typeof content === 'string' ? content.trim() : '';

    if (!normalizedTitle) {
        throw new ResourceValidationError('Enter a title for this resource.', {
            code: 'TEXT_RESOURCE_TITLE_REQUIRED',
        });
    }
    if (normalizedTitle.length > TEXT_RESOURCE_TITLE_MAX_LENGTH) {
        throw new ResourceValidationError('Titles must be ' + TEXT_RESOURCE_TITLE_MAX_LENGTH + ' characters or fewer.', {
            code: 'TEXT_RESOURCE_TITLE_TOO_LONG',
        });
    }
    if (!normalizedContent) {
        throw new ResourceValidationError('Enter text content before saving.', {
            code: 'TEXT_RESOURCE_CONTENT_REQUIRED',
        });
    }
    if (normalizedContent.length > TEXT_RESOURCE_CONTENT_MAX_LENGTH) {
        throw new ResourceValidationError('Text content must be ' + TEXT_RESOURCE_CONTENT_MAX_LENGTH + ' characters or fewer.', {
            code: 'TEXT_RESOURCE_CONTENT_TOO_LONG',
        });
    }

    const normalizedTags = normalizeTags(tags);
    validateTags(normalizedTags);

    return {
        title: normalizedTitle,
        content: normalizedContent,
        tags: normalizedTags,
    };
}

export function createTextResourceInput(formValues) {
    return {
        ...validateTextResourceInput(formValues),
        type: 'text',
        source: 'manual://text-entry',
        status: 'completed',
        metadata: { entryMethod: 'manual' },
    };
}

export function createTextResourceUpdate(formValues) {
    return {
        ...validateTextResourceInput(formValues),
        status: 'completed',
    };
}
