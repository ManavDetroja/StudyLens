/**
 * Meaningful, UI-safe errors for the local content-processing pipeline.
 * They deliberately remain separate from IndexedDB storage errors: processing
 * works on a Resource snapshot and does not write to the database.
 */
export class ContentProcessingError extends Error {
    constructor(message, { code = 'CONTENT_PROCESSING_ERROR', cause } = {}) {
        super(message);
        this.name = 'ContentProcessingError';
        this.code = code;
        if (cause !== undefined) this.cause = cause;
    }
}

export function asContentProcessingError(error, message, code = 'CONTENT_PROCESSING_ERROR') {
    if (error instanceof ContentProcessingError) return error;
    return new ContentProcessingError(message, { code, cause: error });
}
