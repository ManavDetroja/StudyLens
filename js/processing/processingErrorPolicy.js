/**
 * Processing failure policy — Day 22.
 *
 * Pure, dependency-free classification of processing failures into
 * retryable (potentially transient) and permanent (retrying cannot help)
 * groups, plus short UI-safe messages. Error stacks and raw causes are never
 * exposed to the UI; only the canonical code and a friendly message are.
 *
 * Strategy:
 *   - Permanent: invalid/unsupported/missing source data, deterministic
 *     normalization/chunking failures, unavailable transcripts, invalid PDFs.
 *   - Retryable: storage/transaction failures, interrupted processing,
 *     transcript fetch failures, and generic extraction (OCR/PDF worker)
 *     failures whose root cause is unknown.
 *   - Unknown codes are treated as retryable; the attempt limit bounds them.
 *   - SOURCE_CHANGED_DURING_PROCESSING is not a failure at all: the queue
 *     supersedes the result and re-runs against the new source.
 */

export const SOURCE_CHANGED_CODE = 'SOURCE_CHANGED_DURING_PROCESSING';
export const RESOURCE_DELETED_CODE = 'RESOURCE_DELETED_DURING_PROCESSING';
export const INTERRUPTED_CODE = 'PROCESSING_INTERRUPTED';
export const RETRY_LIMIT_CODE = 'RETRY_LIMIT_REACHED';

export const PERMANENT_ERROR_CODES = Object.freeze([
    'UNSUPPORTED_RESOURCE_TYPE',
    'UNSUPPORTED_SOURCE',
    'RESOURCE_CONTENT_MISSING',
    'MISSING_SOURCE',
    'FILE_BLOB_MISSING',
    'MISSING_BLOB',
    'NO_SELECTABLE_TEXT',
    'NO_EXTRACTED_TEXT',
    'INVALID_PDF',
    'INVALID_PDF_DATA',
    'EMPTY_PDF',
    'PDF_DATA_MISSING',
    'TRANSCRIPT_UNAVAILABLE',
    'INVALID_EXTRACTED_CONTENT',
    'INVALID_NORMALIZED_CONTENT',
    'INVALID_TEXT_CONTENT',
    'NORMALIZATION_FAILED',
    'CHUNKING_FAILED',
    'INVALID_CHUNK_SIZE',
    'PROCESSING_INVALID_RESOURCE',
    'RESOURCE_NOT_FOUND',
    RESOURCE_DELETED_CODE,
]);

export const RETRYABLE_ERROR_CODES = Object.freeze([
    'PERSISTENCE_FAILED',
    'STORAGE_ERROR',
    'STORAGE_RETRIEVAL_FAILED',
    'STORAGE_OPERATION_FAILED',
    'REQUEST_FAILED',
    'TRANSACTION_FAILED',
    'TRANSACTION_ABORTED',
    'TRANSACTION_OPEN_FAILED',
    'TRANSCRIPT_FETCH_FAILED',
    'OCR_WORKER_FAILED',
    INTERRUPTED_CODE,
]);

/** Cause error names (pdf.js and DOM) that indicate permanent source problems. */
const PERMANENT_CAUSE_NAMES = Object.freeze([
    'InvalidPDFException',
    'PasswordException',
    'FormatError',
    'MissingPDFException',
]);

const MAX_CAUSE_DEPTH = 5;

/**
 * Walk an error and its `cause` chain.
 * @param {unknown} error
 * @returns {Array<{code?: string, name?: string}>}
 */
function causeChain(error) {
    const chain = [];
    let current = error;
    while (current && typeof current === 'object' && chain.length < MAX_CAUSE_DEPTH) {
        chain.push(current);
        current = current.cause;
    }
    return chain;
}

/**
 * Classify a processing error.
 *
 * @param {unknown} error
 * @returns {{ code: string, retryable: boolean, superseded: boolean }}
 */
export function classifyFailure(error) {
    if (!error || typeof error !== 'object') {
        return { code: 'PROCESSING_FAILED', retryable: true, superseded: false };
    }

    const chain = causeChain(error);
    const topCode = typeof error.code === 'string' && error.code ? error.code : 'PROCESSING_FAILED';

    if (chain.some((e) => e.code === SOURCE_CHANGED_CODE)) {
        return { code: SOURCE_CHANGED_CODE, retryable: true, superseded: true };
    }

    if (PERMANENT_ERROR_CODES.includes(topCode)) {
        return { code: topCode, retryable: false, superseded: false };
    }
    if (RETRYABLE_ERROR_CODES.includes(topCode)) {
        return { code: topCode, retryable: true, superseded: false };
    }

    /* A generic wrapper (e.g. EXTRACTION_FAILED) whose root cause is permanent. */
    const permanentCause = chain.slice(1).find((e) =>
        PERMANENT_CAUSE_NAMES.includes(e.name)
        || (typeof e.code === 'string' && PERMANENT_ERROR_CODES.includes(e.code)));
    if (permanentCause) {
        return { code: topCode, retryable: false, superseded: false };
    }

    /* Generic wrapper (e.g. EXTRACTION_FAILED) or unknown code: bounded retry. */
    return { code: topCode, retryable: true, superseded: false };
}

/**
 * Determine whether a persisted failure code is retryable.
 * Used for resources that only have `processingErrorCode` metadata.
 *
 * @param {string|undefined|null} code
 * @returns {boolean}
 */
export function isRetryableCode(code) {
    if (!code) return true;
    return classifyFailure({ code }).retryable;
}

const MESSAGES = Object.freeze({
    NO_SELECTABLE_TEXT: 'No selectable text was found in this PDF.',
    NO_EXTRACTED_TEXT: 'No readable text could be extracted from this image.',
    INVALID_PDF: 'This PDF could not be read. It may be damaged or password protected.',
    INVALID_PDF_DATA: 'This PDF could not be read. It may be damaged or password protected.',
    EMPTY_PDF: 'This PDF has no pages to read.',
    FILE_BLOB_MISSING: 'The stored file is missing. Please import it again.',
    MISSING_BLOB: 'The stored file is missing. Please import it again.',
    RESOURCE_CONTENT_MISSING: 'This resource has no content to process.',
    TRANSCRIPT_UNAVAILABLE: 'Transcript unavailable. Paste the transcript to continue.',
    UNSUPPORTED_RESOURCE_TYPE: 'This resource type cannot be processed.',
    NORMALIZATION_FAILED: 'The content could not be prepared for study.',
    CHUNKING_FAILED: 'The content could not be split into study sections.',
    PERSISTENCE_FAILED: 'The result could not be saved locally. Please retry.',
    STORAGE_ERROR: 'Local storage had a problem. Please retry.',
    EXTRACTION_FAILED: 'Content extraction failed. Please retry.',
    TRANSCRIPT_FETCH_FAILED: 'The transcript could not be retrieved. Please retry.',
    [INTERRUPTED_CODE]: 'Processing was interrupted (the page was closed or reloaded). You can retry.',
    [RETRY_LIMIT_CODE]: 'Retry limit reached.',
    [RESOURCE_DELETED_CODE]: 'The resource was deleted during processing.',
});

/**
 * UI-safe, stack-free failure message for a canonical code.
 *
 * @param {string|undefined|null} code
 * @returns {string}
 */
export function getFailureMessage(code) {
    return MESSAGES[code] ?? 'Processing failed. Please retry.';
}
