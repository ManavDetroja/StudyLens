/**
 * Image Source Adapter — Day 20.
 *
 * Implements the SourceAdapter contract for image learning materials:
 * 1. canHandle(resource) -> true if resource.type === 'image'
 * 2. extract(resource, options) -> retrieves text from image content,
 *    metadata, or blob storage with pluggable OCR extraction
 * 3. normalize(extractedContent, resource, options) -> normalizes text
 *    deterministically and builds the normalized content model.
 */

import { ContentProcessingError } from './errors.js';
import { normalizeTextContent } from './textNormalizer.js';
import { getFileBlob } from '../features/fileImportService.js';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export const imageAdapter = Object.freeze({
    id: 'image',

    canHandle(resource) {
        return Boolean(resource && resource.type === 'image');
    },

    async extract(resource, options = {}) {
        if (!this.canHandle(resource)) {
            throw new ContentProcessingError('The image adapter only supports image resources.', {
                code: 'UNSUPPORTED_RESOURCE_TYPE',
            });
        }

        // 1. Check for directly supplied or pre-extracted text
        let extractedText = null;
        if (typeof options.text === 'string' && options.text.trim() !== '') {
            extractedText = options.text;
        } else if (typeof options.extractedText === 'string' && options.extractedText.trim() !== '') {
            extractedText = options.extractedText;
        } else if (typeof resource.content === 'string' && resource.content.trim() !== '') {
            extractedText = resource.content;
        } else if (typeof resource.metadata?.extractedText === 'string' && resource.metadata.extractedText.trim() !== '') {
            extractedText = resource.metadata.extractedText;
        } else if (typeof resource.metadata?.ocrText === 'string' && resource.metadata.ocrText.trim() !== '') {
            extractedText = resource.metadata.ocrText;
        }

        // 2. Check for binary blob if needed or to verify blob presence
        let blob = resource.blob || options.blob;
        if (!blob) {
            const blobGetter = options.getBlob ?? getFileBlob;
            try {
                const blobRecord = await blobGetter(resource.id);
                blob = blobRecord?.blob ?? null;
            } catch (storageErr) {
                // If we don't have direct text, storage error is fatal
                if (!extractedText) {
                    throw new ContentProcessingError('Failed to retrieve image file from storage.', {
                        code: 'STORAGE_RETRIEVAL_FAILED',
                        cause: storageErr,
                    });
                }
            }
        }

        // 3. If an OCR extractor is provided and blob is present, invoke it
        if (typeof options.ocrExtractor === 'function' && blob) {
            try {
                const ocrResult = await options.ocrExtractor(blob, options);
                if (typeof ocrResult === 'string' && ocrResult.trim() !== '') {
                    extractedText = ocrResult;
                } else if (ocrResult && typeof ocrResult.text === 'string' && ocrResult.text.trim() !== '') {
                    extractedText = ocrResult.text;
                }
            } catch (ocrErr) {
                throw new ContentProcessingError('Failed to extract text from image with OCR.', {
                    code: 'EXTRACTION_FAILED',
                    cause: ocrErr,
                });
            }
        }

        // 4. Validate that we found text or blob
        if (!extractedText && !blob) {
            throw new ContentProcessingError('Image file data is missing or could not be retrieved.', {
                code: 'FILE_BLOB_MISSING',
            });
        }

        if (!extractedText) {
            throw new ContentProcessingError('No readable text could be extracted from this image. Please ensure the image contains legible text.', {
                code: 'NO_EXTRACTED_TEXT',
            });
        }

        return {
            text: extractedText,
            metadata: {
                format: resource.metadata?.extension || 'image',
                originalFileName: resource.metadata?.originalFileName || resource.title,
                mimeType: resource.metadata?.mimeType,
                fileSize: resource.metadata?.fileSize,
                ...(isPlainObject(options.metadata) ? options.metadata : {}),
            },
        };
    },

    normalize(extractedContent, resource) {
        if (!extractedContent) {
            throw new ContentProcessingError('Invalid extracted image content.', {
                code: 'INVALID_EXTRACTED_CONTENT',
            });
        }

        const rawText = typeof extractedContent === 'string'
            ? extractedContent
            : extractedContent.text;

        if (typeof rawText !== 'string' || rawText.trim() === '') {
            throw new ContentProcessingError('This image resource has no readable text content to process.', {
                code: 'RESOURCE_CONTENT_MISSING',
            });
        }

        const normalizedText = normalizeTextContent(rawText);
        if (normalizedText === '') {
            throw new ContentProcessingError('This image resource has no readable content to process.', {
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
                ...extractedMeta,
            },
        };
    },
});
