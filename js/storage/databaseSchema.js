import { StorageError } from './errors.js';

export const DATABASE_NAME = 'StudyLensDB';
export const DATABASE_VERSION = 6;
export const RESOURCE_STORE = 'resources';
export const PROCESSED_CONTENT_STORE = 'processedContent';
export const LEARNING_OUTPUT_STORE = 'learningOutputs';
export const QUIZ_STORE = 'quizzes';
export const QUIZ_ATTEMPT_STORE = 'quizAttempts';
export const NOTE_STORE = 'notes';

export const RESOURCE_INDEXES = Object.freeze([
    { name: 'type', keyPath: 'type' },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'updatedAt', keyPath: 'updatedAt' },
    { name: 'status', keyPath: 'status' },
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
}

