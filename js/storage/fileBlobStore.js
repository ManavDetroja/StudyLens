import { FILE_BLOB_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: 'STORAGE_REQUEST_FAILED',
                cause: request.error,
            }));
        });
    });
}

function transactionToPromise(transaction, operation) {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve());
        transaction.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: 'TRANSACTION_FAILED',
                cause: transaction.error,
            }));
        });
        transaction.addEventListener('abort', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: 'TRANSACTION_ABORTED',
                cause: transaction.error,
            }));
        });
    });
}

function validateResourceId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new StorageError('A resource id is required.', { code: 'INVALID_RESOURCE_ID' });
    }
}

export class FileBlobRepository {
    constructor({ database = studyLensDatabase } = {}) {
        this.database = database;
    }

    async saveFileBlob(resourceId, blob) {
        validateResourceId(resourceId);

        if (!blob || !(blob instanceof Blob)) {
            throw new StorageError('A valid Blob is required.', { code: 'INVALID_BLOB' });
        }

        const record = {
            resourceId,
            blob,
            mimeType: blob.type || 'application/octet-stream',
            size: blob.size,
            savedAt: new Date().toISOString(),
        };

        await this.withStore('readwrite', 'save the file blob', async (store) => {
            await requestToPromise(store.put(record), 'save the file blob');
        });

        return record;
    }

    async getFileBlob(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readonly', 'read the file blob', (store) => {
            return requestToPromise(store.get(resourceId), 'read the file blob');
        }).then((record) => record ?? null);
    }

    async deleteFileBlob(resourceId) {
        validateResourceId(resourceId);

        return this.withStore('readwrite', 'delete the file blob', async (store) => {
            const existing = await requestToPromise(store.get(resourceId), 'check the file blob');
            if (!existing) {
                return false;
            }

            await requestToPromise(store.delete(resourceId), 'delete the file blob');
            return true;
        });
    }

    async withStore(mode, operation, callback) {
        const database = await this.database.open();

        if (!database.objectStoreNames.contains(FILE_BLOB_STORE)) {
            throw new StorageError('StudyLens fileBlobs storage is unavailable.', {
                code: 'OBJECT_STORE_MISSING',
            });
        }

        let transaction;

        try {
            transaction = database.transaction(FILE_BLOB_STORE, mode);
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not start a storage transaction.', 'TRANSACTION_OPEN_FAILED');
        }

        const completion = transactionToPromise(transaction, operation);

        try {
            const result = await callback(transaction.objectStore(FILE_BLOB_STORE));
            await completion;
            return result;
        } catch (error) {
            try {
                transaction.abort();
            } catch {
                // The transaction may already have completed or aborted.
            }

            await completion.catch(() => undefined);
            throw asStorageError(error, 'StudyLens could not ' + operation + '.', 'STORAGE_OPERATION_FAILED');
        }
    }
}

export const fileBlobRepository = new FileBlobRepository();
