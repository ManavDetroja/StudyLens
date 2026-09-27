import { ResourceValidationError } from '../storage/errors.js';
import {
    FILE_IMPORT_CONFIG,
    getResourceTypeFromMime,
    getResourceTypeFromExtension,
    getMimeTypeFromExtension,
} from './fileImportConfig.js';
import { normalizeTags, validateTags } from '../utils/tagUtils.js';

export function validateFile(file) {
    const isFileInstance = typeof File !== 'undefined' && file instanceof File;
    const isBlobWithFilename = typeof Blob !== 'undefined' && file instanceof Blob && typeof file.name === 'string';
    const isMockFile = file && typeof file === 'object' && typeof file.name === 'string' && typeof file.size === 'number';

    if (!file || (!isFileInstance && !isBlobWithFilename && !isMockFile)) {
        throw new ResourceValidationError('No file was selected.', {
            code: 'FILE_IMPORT_NO_FILE',
        });
    }

    if (file.size === 0) {
        throw new ResourceValidationError('The selected file is empty.', {
            code: 'FILE_IMPORT_EMPTY_FILE',
        });
    }

    if (file.size > FILE_IMPORT_CONFIG.maxFileSizeBytes) {
        throw new ResourceValidationError(
            'File size exceeds the ' + FILE_IMPORT_CONFIG.maxFileSizeMB + ' MB limit.',
            { code: 'FILE_IMPORT_FILE_TOO_LARGE' }
        );
    }

    const mimeType = (file.type || '').toLowerCase();
    const extension = getExtension(file.name);
    const isMimeAllowed = FILE_IMPORT_CONFIG.allowedMimeTypes.includes(mimeType);
    const isExtAllowed = FILE_IMPORT_CONFIG.allowedExtensions.includes(extension);

    if (!isMimeAllowed && !isExtAllowed) {
        throw new ResourceValidationError(
            'Unsupported file type. Please upload a PDF or image file (JPG, PNG, WEBP).',
            { code: 'FILE_IMPORT_UNSUPPORTED_TYPE' }
        );
    }

    return file;
}

export function getExtension(filename) {
    if (typeof filename !== 'string') return '';
    const lastDot = filename.lastIndexOf('.');
    if (lastDot < 0) return '';
    return filename.slice(lastDot).toLowerCase();
}

export function sanitizeFilename(filename) {
    if (typeof filename !== 'string') return 'Untitled';
    // Remove path separators and control characters
    const cleaned = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    return cleaned || 'Untitled';
}

export function deriveTitle(filename) {
    const sanitized = sanitizeFilename(filename);
    // Remove extension
    const lastDot = sanitized.lastIndexOf('.');
    const baseName = lastDot > 0 ? sanitized.slice(0, lastDot) : sanitized;
    return baseName.trim().slice(0, FILE_IMPORT_CONFIG.titleMaxLength) || 'Untitled';
}

export function validateFileImportInput({ title, tags }) {
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';

    if (!normalizedTitle) {
        throw new ResourceValidationError('Enter a title for this resource.', {
            code: 'FILE_IMPORT_TITLE_REQUIRED',
        });
    }
    if (normalizedTitle.length > FILE_IMPORT_CONFIG.titleMaxLength) {
        throw new ResourceValidationError(
            'Titles must be ' + FILE_IMPORT_CONFIG.titleMaxLength + ' characters or fewer.',
            { code: 'FILE_IMPORT_TITLE_TOO_LONG' }
        );
    }

    const normalizedTags = normalizeTags(tags);
    validateTags(normalizedTags);

    return {
        title: normalizedTitle,
        tags: normalizedTags,
    };
}

export function createFileResourceInput(file, { title, tags }) {
    const validated = validateFileImportInput({ title, tags });
    const rawMimeType = (file.type || '').toLowerCase();
    const extension = getExtension(file.name);
    const resourceType = getResourceTypeFromMime(rawMimeType) || getResourceTypeFromExtension(extension);
    const mimeType = rawMimeType || getMimeTypeFromExtension(extension) || 'application/octet-stream';

    if (!resourceType) {
        throw new ResourceValidationError('Cannot determine resource type from file.', {
            code: 'FILE_IMPORT_TYPE_UNKNOWN',
        });
    }

    return {
        title: validated.title,
        type: resourceType,
        source: 'local://file-import',
        content: null,
        status: 'pending',
        tags: validated.tags,
        metadata: {
            entryMethod: 'file-import',
            originalFileName: sanitizeFilename(file.name),
            mimeType: mimeType,
            fileSize: file.size,
            extension: extension,
        },
    };
}
