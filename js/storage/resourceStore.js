import { RESOURCE_STORE } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';
import { studyLensDatabase } from './indexedDB.js';
import {
    RESOURCE_STATUSES,
    RESOURCE_TYPES,
    createResourceRecord,
    createUpdatedResource,
    generateResourceId,
} from './resourceValidation.js';

function requestToPromise(request, operation) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
            reject(new StorageError('StudyLens could not ' + operation + '.', {
                code: request.error?.name === 'ConstraintError' ? 'DUPLICATE_RESOURCE_ID' : 'REQUEST_FAILED',
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

export function sortByCreatedAt(resources, direction = 'descending') {
    const multiplier = direction === 'ascending' ? 1 : -1;

    return [...resources].sort((first, second) => {
        return (Date.parse(first.createdAt) - Date.parse(second.createdAt)) * multiplier;
    });
}

export class ResourceRepository {
    constructor({
        database = studyLensDatabase,
        idGenerator = generateResourceId,
        clock = () => new Date(),
    } = {}) {
        this.database = database;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    async createResource(input) {
        const resource = createResourceRecord(input, {
            idGenerator: this.idGenerator,
            clock: this.clock,
        });

        await this.withStore('readwrite', 'create the resource', async (store) => {
            await requestToPromise(store.add(resource), 'create the resource');
        });

        return resource;
    }

    async getResource(id) {
        validateResourceId(id);

        return this.withStore('readonly', 'read the resource', (store) => {
            return requestToPromise(store.get(id), 'read the resource');
        }).then((resource) => resource ?? null);
    }

    async getAllResources() {
        const resources = await this.withStore('readonly', 'read all resources', (store) => {
            return requestToPromise(store.getAll(), 'read all resources');
        });

        return sortByCreatedAt(resources);
    }

    async getResourcesByType(type) {
        if (!RESOURCE_TYPES.includes(type)) {
            throw new StorageError('Unsupported resource type: ' + type + '.', {
                code: 'INVALID_RESOURCE_TYPE',
            });
        }

        const resources = await this.withStore('readonly', 'read resources by type', (store) => {
            return requestToPromise(store.index('type').getAll(type), 'read resources by type');
        });

        return sortByCreatedAt(resources);
    }

    async getResourcesByStatus(status) {
        if (!RESOURCE_STATUSES.includes(status)) {
            throw new StorageError('Unsupported resource status: ' + status + '.', {
                code: 'INVALID_RESOURCE_STATUS',
            });
        }

        const resources = await this.withStore('readonly', 'read resources by status', (store) => {
            return requestToPromise(store.index('status').getAll(status), 'read resources by status');
        });

        return sortByCreatedAt(resources);
    }

    async updateResource(id, updates) {
        validateResourceId(id);

        return this.withStore('readwrite', 'update the resource', async (store) => {
            const existingResource = await requestToPromise(store.get(id), 'read the resource for updating');
            if (!existingResource) {
                throw new StorageError('The requested resource does not exist.', {
                    code: 'RESOURCE_NOT_FOUND',
                });
            }

            const updatedResource = createUpdatedResource(existingResource, updates, {
                clock: this.clock,
            });
            await requestToPromise(store.put(updatedResource), 'update the resource');
            return updatedResource;
        });
    }

    async deleteResource(id) {
        validateResourceId(id);

        return this.withStore('readwrite', 'delete the resource', async (store) => {
            const existingResource = await requestToPromise(store.get(id), 'read the resource for deleting');
            if (!existingResource) return false;

            await requestToPromise(store.delete(id), 'delete the resource');
            return true;
        });
    }

    async clearResources() {
        return this.withStore('readwrite', 'clear resources', async (store) => {
            const count = await requestToPromise(store.count(), 'count resources');
            await requestToPromise(store.clear(), 'clear resources');
            return count;
        });
    }

    async countResources() {
        return this.withStore('readonly', 'count resources', (store) => {
            return requestToPromise(store.count(), 'count resources');
        });
    }

    async withStore(mode, operation, callback) {
        const database = await this.database.open();

        if (!database.objectStoreNames.contains(RESOURCE_STORE)) {
            throw new StorageError('StudyLens resources storage is unavailable.', {
                code: 'OBJECT_STORE_MISSING',
            });
        }

        let transaction;

        try {
            transaction = database.transaction(RESOURCE_STORE, mode);
        } catch (error) {
            throw asStorageError(error, 'StudyLens could not start a storage transaction.', 'TRANSACTION_OPEN_FAILED');
        }

        const completion = transactionToPromise(transaction, operation);

        try {
            const result = await callback(transaction.objectStore(RESOURCE_STORE));
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

export const resourceRepository = new ResourceRepository();
