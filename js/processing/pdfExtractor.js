/**
 * Pure PDF Text Extractor — Day 17.
 *
 * Extracts text page-by-page from raw PDF binary data using PDF.js.
 * Preserves page numbering and page boundaries.
 * Enforces validation for empty, corrupted, and non-selectable PDFs.
 */

import { ContentProcessingError, asContentProcessingError } from './errors.js';
import { getPdfJs } from './pdfParserLoader.js';

/**
 * Convert input (Blob, File, ArrayBuffer, Uint8Array) into a Uint8Array.
 *
 * @param {Blob|File|ArrayBuffer|Uint8Array} input
 * @returns {Promise<Uint8Array>}
 */
async function toUint8Array(input) {
    if (!input) {
        throw new ContentProcessingError('No PDF data was provided.', {
            code: 'PDF_DATA_MISSING',
        });
    }

    if (input instanceof Uint8Array) {
        return input;
    }

    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }

    if (typeof input.arrayBuffer === 'function') {
        const buffer = await input.arrayBuffer();
        return new Uint8Array(buffer);
    }

    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }

    throw new ContentProcessingError('Unsupported PDF data format.', {
        code: 'INVALID_PDF_DATA',
    });
}

/**
 * Extract plain text items from a PDF text content collection.
 *
 * @param {object} textContent
 * @returns {string}
 */
function extractPageText(textContent) {
    if (!textContent || !Array.isArray(textContent.items)) {
        return '';
    }

    const chunks = [];
    for (let i = 0; i < textContent.items.length; i++) {
        const item = textContent.items[i];
        if (typeof item.str === 'string' && item.str.length > 0) {
            chunks.push(item.str);
            if (item.hasEOL) {
                chunks.push('\n');
            } else {
                chunks.push(' ');
            }
        }
    }

    return chunks.join('').trim();
}

/**
 * Extract structured text from a PDF binary.
 *
 * @param {Blob|File|ArrayBuffer|Uint8Array} pdfData
 * @param {object} [options]
 * @param {Function} [options.getPdfLib]
 * @returns {Promise<{ numPages: number, pages: Array<{ pageNumber: number, text: string }>, metadata: object }>}
 */
export async function extractPdfText(pdfData, options = {}) {
    const uint8 = await toUint8Array(pdfData);

    if (uint8.byteLength === 0) {
        throw new ContentProcessingError('The PDF document is empty.', {
            code: 'EMPTY_PDF',
        });
    }

    const pdfLibGetter = options.getPdfLib ?? getPdfJs;
    let pdfjs;
    try {
        pdfjs = await pdfLibGetter();
    } catch (libErr) {
        throw asContentProcessingError(libErr, 'PDF parser library could not be loaded.', 'PDF_PARSER_UNAVAILABLE');
    }

    let doc;
    try {
        const loadingTask = pdfjs.getDocument({
            data: uint8,
            disableFontFace: true,
            isEvalSupported: false,
            useSystemFonts: true,
        });
        doc = await loadingTask.promise;
    } catch (parseErr) {
        const errMessage = parseErr?.message || '';
        const errName = parseErr?.name || '';
        if (errName === 'InvalidPDFException' || errMessage.includes('Invalid PDF') || errMessage.includes('corrupted') || errMessage.includes('PDFHeader')) {
            throw new ContentProcessingError('The PDF file is invalid or corrupted.', {
                code: 'INVALID_PDF',
                cause: parseErr,
            });
        }
        throw asContentProcessingError(parseErr, 'StudyLens could not parse this PDF.', 'PDF_PARSER_ERROR');
    }

    const numPages = doc.numPages;
    if (!Number.isInteger(numPages) || numPages < 1) {
        throw new ContentProcessingError('The PDF document contains no pages.', {
            code: 'EMPTY_PDF',
        });
    }

    const pages = [];
    let totalTextLength = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        let page;
        try {
            page = await doc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const text = extractPageText(textContent);
            totalTextLength += text.length;

            pages.push({
                pageNumber: pageNum,
                text,
            });
        } catch (pageErr) {
            throw asContentProcessingError(
                pageErr,
                `StudyLens failed to extract text from page ${pageNum} of the PDF.`,
                'PAGE_EXTRACTION_FAILED'
            );
        } finally {
            if (page && typeof page.cleanup === 'function') {
                try { page.cleanup(); } catch { /* non-fatal cleanup */ }
            }
        }
    }

    // Clean up document worker/resources if supported
    if (typeof doc.cleanup === 'function') {
        try { doc.cleanup(); } catch { /* non-fatal */ }
    }
    if (typeof doc.destroy === 'function') {
        try { doc.destroy(); } catch { /* non-fatal */ }
    }

    // Check if the entire document had no extractable text (e.g. image-only / scanned PDF)
    if (totalTextLength === 0) {
        throw new ContentProcessingError(
            'No selectable text was found in this PDF. OCR will be supported in a future milestone.',
            { code: 'NO_SELECTABLE_TEXT' }
        );
    }

    return {
        numPages,
        pages,
        metadata: {
            pageCount: numPages,
            fingerprint: doc.fingerprint || null,
        },
    };
}
