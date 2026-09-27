import { StorageError } from './errors.js';

export const DATABASE_NAME = 'StudyLensDB';
export const DATABASE_VERSION = 8;
export const RESOURCE_STORE = 'resources';
export const PROCESSED_CONTENT_STORE = 'processedContent';
export const LEARNING_OUTPUT_STORE = 'learningOutputs';
export const QUIZ_STORE = 'quizzes';
export const QUIZ_ATTEMPT_STORE = 'quizAttempts';
export const NOTE_STORE = 'notes';
export const FILE_BLOB_STORE = 'fileBlobs';

export const ALL_REQUIRED_STORES = Object.freeze([
    RESOURCE_STORE,
    PROCESSED_CONTENT_STORE,
    LEARNING_OUTPUT_STORE,
    QUIZ_STORE,
    QUIZ_ATTEMPT_STORE,
    NOTE_STORE,
    FILE_BLOB_STORE,
]);

export const RESOURCE_INDEXES = Object.freeze([
    { name: 'type', keyPath: 'type' },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'updatedAt', keyPath: 'updatedAt' },
    { name: 'status', keyPath: 'status' },
]);

export const PROCESSED_CONTENT_INDEXES = Object.freeze([
    { name: 'resourceId', keyPath: 'resourceId', unique: true },
]);

export const LEARNING_OUTPUT_INDEXES = Object.freeze([
    { name: 'resourceId', keyPath: 'resourceId', unique: false },
    { name: 'type', keyPath: 'type', unique: false },
    { name: 'createdAt', keyPath: 'createdAt', unique: false },
]);

export const QUIZ_INDEXES = Object.freeze([
    { name: 'resourceId', keyPath: 'resourceId', unique: false },
    { name: 'createdAt', keyPath: 'createdAt', unique: false },
]);

export const QUIZ_ATTEMPT_INDEXES = Object.freeze([
    { name: 'quizId', keyPath: 'quizId', unique: false },
    { name: 'resourceId', keyPath: 'resourceId', unique: false },
    { name: 'completedAt', keyPath: 'completedAt', unique: false },
    { name: 'createdAt', keyPath: 'createdAt', unique: false },
]);

export const NOTE_INDEXES = Object.freeze([
    { name: 'resourceId', keyPath: 'resourceId', unique: false },
    { name: 'updatedAt', keyPath: 'updatedAt', unique: false },
    { name: 'createdAt', keyPath: 'createdAt', unique: false },
]);

export function ensureStore(database, transaction, storeName, keyOptions) {
    if (database.objectStoreNames.contains(storeName)) {
        return transaction.objectStore(storeName);
    }

    return database.createObjectStore(storeName, keyOptions);
}

export function ensureStoreIndexes(store, indexDefinitions) {
    if (!store || !Array.isArray(indexDefinitions)) return;
    indexDefinitions.forEach(({ name, keyPath, unique = false }) => {
        if (!store.indexNames.contains(name)) {
            store.createIndex(name, keyPath, { unique: Boolean(unique) });
        }
    });
}

export function ensureAllRequiredStoresAndIndexes(database, transaction) {
    // 1. Resources store (keyPath: 'id')
    const resourceStore = ensureStore(database, transaction, RESOURCE_STORE, { keyPath: 'id' });
    ensureStoreIndexes(resourceStore, RESOURCE_INDEXES);

    // 2. Processed content store (keyPath: 'id')
    const processedStore = ensureStore(database, transaction, PROCESSED_CONTENT_STORE, { keyPath: 'id' });
    ensureStoreIndexes(processedStore, PROCESSED_CONTENT_INDEXES);

    // 3. Learning outputs store (keyPath: 'id') - houses summary, concepts, definitions, questions, flashcards
    const learningOutputStore = ensureStore(database, transaction, LEARNING_OUTPUT_STORE, { keyPath: 'id' });
    ensureStoreIndexes(learningOutputStore, LEARNING_OUTPUT_INDEXES);

    // 4. Quizzes store (keyPath: 'id')
    const quizStore = ensureStore(database, transaction, QUIZ_STORE, { keyPath: 'id' });
    ensureStoreIndexes(quizStore, QUIZ_INDEXES);

    // 5. Quiz attempts store (keyPath: 'id')
    const attemptStore = ensureStore(database, transaction, QUIZ_ATTEMPT_STORE, { keyPath: 'id' });
    ensureStoreIndexes(attemptStore, QUIZ_ATTEMPT_INDEXES);

    // 6. Notes store (keyPath: 'id')
    const noteStore = ensureStore(database, transaction, NOTE_STORE, { keyPath: 'id' });
    ensureStoreIndexes(noteStore, NOTE_INDEXES);

    // 7. File blobs store (keyPath: 'resourceId')
    ensureStore(database, transaction, FILE_BLOB_STORE, { keyPath: 'resourceId' });
}

export function upgradeDatabaseSchema(database, transaction, oldVersion) {
    if (!transaction) {
        throw new StorageError('StudyLens could not prepare the database schema.', {
            code: 'MIGRATION_TRANSACTION_MISSING',
        });
    }

    // Historical sequential migration paths (v1 -> v7)
    if (oldVersion < 1) {
        const resourceStore = ensureStore(database, transaction, RESOURCE_STORE, { keyPath: 'id' });
        ensureStoreIndexes(resourceStore, RESOURCE_INDEXES);
    }

    if (oldVersion < 2) {
        if (!database.objectStoreNames.contains(PROCESSED_CONTENT_STORE)) {
            const processedStore = database.createObjectStore(PROCESSED_CONTENT_STORE, { keyPath: 'id' });
            processedStore.createIndex('resourceId', 'resourceId', { unique: true });
        }
    }

    if (oldVersion < 3) {
        if (!database.objectStoreNames.contains(LEARNING_OUTPUT_STORE)) {
            const learningOutputStore = database.createObjectStore(LEARNING_OUTPUT_STORE, { keyPath: 'id' });
            LEARNING_OUTPUT_INDEXES.forEach(({ name, keyPath, unique }) => {
                learningOutputStore.createIndex(name, keyPath, { unique });
            });
        }
    }

    if (oldVersion < 4) {
        if (!database.objectStoreNames.contains(QUIZ_STORE)) {
            const quizStore = database.createObjectStore(QUIZ_STORE, { keyPath: 'id' });
            QUIZ_INDEXES.forEach(({ name, keyPath, unique }) => {
                quizStore.createIndex(name, keyPath, { unique });
            });
        }
    }

    if (oldVersion < 5) {
        if (!database.objectStoreNames.contains(QUIZ_ATTEMPT_STORE)) {
            const attemptStore = database.createObjectStore(QUIZ_ATTEMPT_STORE, { keyPath: 'id' });
            QUIZ_ATTEMPT_INDEXES.forEach(({ name, keyPath, unique }) => {
                attemptStore.createIndex(name, keyPath, { unique });
            });
        }
    }

    if (oldVersion < 6) {
        if (!database.objectStoreNames.contains(NOTE_STORE)) {
            const noteStore = database.createObjectStore(NOTE_STORE, { keyPath: 'id' });
            NOTE_INDEXES.forEach(({ name, keyPath, unique }) => {
                noteStore.createIndex(name, keyPath, { unique });
            });
        }
    }

    if (oldVersion < 7) {
        if (!database.objectStoreNames.contains(FILE_BLOB_STORE)) {
            database.createObjectStore(FILE_BLOB_STORE, { keyPath: 'resourceId' });
        }
    }

    // Version 8: Schema Repair & Self-Healing Migration
    // Reconciles and repairs any missing stores or missing indexes from earlier
    // interrupted, partial, or out-of-order versions without modifying existing records.
    if (oldVersion < 8) {
        ensureAllRequiredStoresAndIndexes(database, transaction);
    }
}
