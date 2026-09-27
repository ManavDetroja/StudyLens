/**
 * PDF Source Adapter — Day 17.
 *
 * Implements the SourceAdapter contract for PDF learning materials:
 * 1. canHandle(resource) -> true if resource.type === 'pdf'
 * 2. extract(resource, options) -> retrieves stored blob and extracts pages
 * 3. normalize(extractedContent, resource, options) -> normalizes text,
 *    records character offsets per page, and builds the normalized content model.
 */

import { ContentProcessingError } from './errors.js';
import { normalizeTextContent } from './textNormalizer.js';
import { extractPdfText } from './pdfExtractor.js';
import { getFileBlob } from '../features/fileImportService.js';

export const pdfAdapter = Object.freeze({
    id: 'pdf',

    canHandle(resource) {
        return resource?.type === 'pdf';
    },

    async extract(resource, options = {}) {
        if (!this.canHandle(resource)) {
            throw new ContentProcessingError('The PDF adapter only supports PDF resources.', {
                code: 'UNSUPPORTED_RESOURCE_TYPE',
            });
        }

        let blob = resource.blob || options.blob;

        if (!blob) {
            const blobGetter = options.getBlob ?? getFileBlob;
            try {
                const blobRecord = await blobGetter(resource.id);
                blob = blobRecord?.blob ?? null;
            } catch (storageErr) {
                throw new ContentProcessingError('Failed to retrieve PDF file from storage.', {
                    code: 'STORAGE_RETRIEVAL_FAILED',
                    cause: storageErr,
                });
            }
        }

        if (!blob) {
            throw new ContentProcessingError('PDF file data is missing or could not be retrieved.', {
                code: 'FILE_BLOB_MISSING',
            });
        }

        return extractPdfText(blob, options);
    },

    normalize(extractedContent, resource) {
        if (!extractedContent || !Array.isArray(extractedContent.pages)) {
            throw new ContentProcessingError('Invalid extracted PDF content.', {
                code: 'INVALID_EXTRACTED_CONTENT',
            });
        }

        const normalizedPages = [];
        const pageOffsets = [];
        const textParts = [];
        let currentOffset = 0;

        for (const page of extractedContent.pages) {
            const rawText = page.text || '';
            const normalizedText = normalizeTextContent(rawText);

            if (!normalizedText) {
                continue;
            }

            if (textParts.length > 0) {
                // Paragraph break between pages
                currentOffset += 2;
            }

            const startOffset = currentOffset;
            const endOffset = startOffset + normalizedText.length;
            currentOffset = endOffset;

            textParts.push(normalizedText);

            normalizedPages.push({
                pageNumber: page.pageNumber,
                text: normalizedText,
            });

            pageOffsets.push({
                pageNumber: page.pageNumber,
                startOffset,
                endOffset,
            });
        }

        const fullText = textParts.join('\n\n').trim();

        if (fullText === '') {
            throw new ContentProcessingError(
                'No selectable text was found in this PDF. OCR will be supported in a future milestone.',
                { code: 'NO_SELECTABLE_TEXT' }
            );
        }

        return {
            resourceId: resource.id,
            sourceType: resource.type,
            text: fullText,
            segments: [],
            createdAt: resource.updatedAt,
            metadata: {
                adapterId: this.id,
                pageCount: extractedContent.numPages,
                extractedPageCount: normalizedPages.length,
                pageOffsets,
                pages: normalizedPages,
            },
        };
    },
});
