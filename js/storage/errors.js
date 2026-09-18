export class StorageError extends Error {
    constructor(message, { code = 'STORAGE_ERROR', cause } = {}) {
        super(message);
        this.name = 'StorageError';
        this.code = code;
        if (cause !== undefined) this.cause = cause;
    }
}

export class ResourceValidationError extends StorageError {
    constructor(message, { code = 'INVALID_RESOURCE', cause } = {}) {
        super(message, { code, cause });
        this.name = 'ResourceValidationError';
    }
}

export function asStorageError(error, message, code = 'STORAGE_ERROR') {
    if (error instanceof StorageError) return error;
    return new StorageError(message, { code, cause: error });
}
