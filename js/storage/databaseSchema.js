import { StorageError } from './errors.js';

export const DATABASE_NAME = 'StudyLensDB';
export const DATABASE_VERSION = 1;
export const RESOURCE_STORE = 'resources';

export const RESOURCE_INDEXES = Object.freeze([
    { name: 'type', keyPath: 'type' },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'updatedAt', keyPath: 'updatedAt' },
    { name: 'status', keyPath: 'status' },
]);

function getResourceStore(database, transaction) {
    if (database.objectStoreNames.contains(RESOURCE_STORE)) {
        return transaction.objectStore(RESOURCE_STORE);
    }

    return database.createObjectStore(RESOURCE_STORE, { keyPath: 'id' });
}

function ensureIndexes(store) {
    RESOURCE_INDEXES.forEach(({ name, keyPath }) => {
        if (!store.indexNames.contains(name)) {
            store.createIndex(name, keyPath, { unique: false });
        }
    });
}

export function upgradeDatabaseSchema(database, transaction, oldVersion) {
    if (!transaction) {
        throw new StorageError('StudyLens could not prepare the database schema.', {
            code: 'MIGRATION_TRANSACTION_MISSING',
        });
    }

    if (oldVersion < 1) {
        const resourceStore = getResourceStore(database, transaction);
        ensureIndexes(resourceStore);
    }
}
