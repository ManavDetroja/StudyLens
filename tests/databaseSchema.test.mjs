import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DATABASE_NAME,
    DATABASE_VERSION,
    RESOURCE_STORE,
    PROCESSED_CONTENT_STORE,
    LEARNING_OUTPUT_STORE,
    QUIZ_STORE,
    QUIZ_ATTEMPT_STORE,
    NOTE_STORE,
    FILE_BLOB_STORE,
    ALL_REQUIRED_STORES,
    RESOURCE_INDEXES,
    PROCESSED_CONTENT_INDEXES,
    LEARNING_OUTPUT_INDEXES,
    QUIZ_INDEXES,
    QUIZ_ATTEMPT_INDEXES,
    NOTE_INDEXES,
    upgradeDatabaseSchema,
    ensureAllRequiredStoresAndIndexes,
} from '../js/storage/databaseSchema.js';
import { DatabaseConnection } from '../js/storage/indexedDB.js';
import { StorageError } from '../js/storage/errors.js';

/* ── Minimal In-Memory Mock IDB ──────────────────────────────────── */

class MockDOMStringList {
    constructor(items = []) {
        this._set = new Set(items);
    }
    contains(name) {
        return this._set.has(name);
    }
    add(name) {
        this._set.add(name);
    }
    get length() {
        return this._set.size;
    }
    [Symbol.iterator]() {
        return this._set.values();
    }
}

class MockObjectStore {
    constructor(name, options = {}) {
        this.name = name;
        this.keyPath = options.keyPath;
        this.autoIncrement = options.autoIncrement || false;
        this.indexNames = new MockDOMStringList();
        this._indexes = new Map();
        this._records = new Map();
    }

    createIndex(name, keyPath, options = {}) {
        this.indexNames.add(name);
        this._indexes.set(name, { name, keyPath, options });
    }

    index(name) {
        if (!this.indexNames.contains(name)) {
            throw new Error(`Index "${name}" does not exist on store "${this.name}".`);
        }
        return this._indexes.get(name);
    }

    add(record) {
        const key = this.keyPath ? record[this.keyPath] : record.id;
        this._records.set(key, record);
    }
}

class MockIDBDatabase {
    constructor(initialStores = []) {
        this.objectStoreNames = new MockDOMStringList();
        this._stores = new Map();
        for (const store of initialStores) {
            this.objectStoreNames.add(store.name);
            this._stores.set(store.name, store);
        }
    }

    createObjectStore(name, options = {}) {
        if (this.objectStoreNames.contains(name)) {
            throw new Error(`Store "${name}" already exists.`);
        }
        const store = new MockObjectStore(name, options);
        this.objectStoreNames.add(name);
        this._stores.set(name, store);
        return store;
    }

    close() {}
    addEventListener(event, handler) {}
}

class MockIDBTransaction {
    constructor(database) {
        this.database = database;
    }

    objectStore(name) {
        if (!this.database.objectStoreNames.contains(name)) {
            const err = new Error(`One of the specified object stores was not found: ${name}`);
            err.name = 'NotFoundError';
            throw err;
        }
        return this.database._stores.get(name);
    }
}

/* ── Unit Tests ─────────────────────────────────────────────────── */

test('1. DATABASE_VERSION is set to 9', () => {
    assert.strictEqual(DATABASE_VERSION, 9);
    assert.strictEqual(DATABASE_NAME, 'StudyLensDB');
});

test('2. ALL_REQUIRED_STORES lists all 8 canonical stores in the codebase', () => {
    assert.deepStrictEqual([...ALL_REQUIRED_STORES], [
        'resources',
        'processedContent',
        'learningOutputs',
        'quizzes',
        'quizAttempts',
        'notes',
        'fileBlobs',
        'studySessions',
    ]);
});

test('3. upgradeDatabaseSchema creates all 8 stores and all indexes on fresh DB (v0 -> v9)', () => {
    const db = new MockIDBDatabase();
    const tx = new MockIDBTransaction(db);

    upgradeDatabaseSchema(db, tx, 0);

    for (const storeName of ALL_REQUIRED_STORES) {
        assert.ok(db.objectStoreNames.contains(storeName), `Missing store: ${storeName}`);
    }

    // Verify resources indexes
    const resStore = tx.objectStore(RESOURCE_STORE);
    RESOURCE_INDEXES.forEach(({ name }) => {
        assert.ok(resStore.indexNames.contains(name), `Missing resources index: ${name}`);
    });

    // Verify processedContent indexes
    const procStore = tx.objectStore(PROCESSED_CONTENT_STORE);
    assert.ok(procStore.indexNames.contains('resourceId'));

    // Verify learningOutputs indexes
    const loStore = tx.objectStore(LEARNING_OUTPUT_STORE);
    LEARNING_OUTPUT_INDEXES.forEach(({ name }) => {
        assert.ok(loStore.indexNames.contains(name), `Missing learningOutputs index: ${name}`);
    });

    // Verify quizzes indexes
    const quizStore = tx.objectStore(QUIZ_STORE);
    QUIZ_INDEXES.forEach(({ name }) => {
        assert.ok(quizStore.indexNames.contains(name), `Missing quizzes index: ${name}`);
    });

    // Verify quizAttempts indexes
    const attemptStore = tx.objectStore(QUIZ_ATTEMPT_STORE);
    QUIZ_ATTEMPT_INDEXES.forEach(({ name }) => {
        assert.ok(attemptStore.indexNames.contains(name), `Missing quizAttempts index: ${name}`);
    });

    // Verify notes indexes
    const noteStore = tx.objectStore(NOTE_STORE);
    NOTE_INDEXES.forEach(({ name }) => {
        assert.ok(noteStore.indexNames.contains(name), `Missing notes index: ${name}`);
    });

    // Verify fileBlobs keyPath
    const blobStore = tx.objectStore(FILE_BLOB_STORE);
    assert.strictEqual(blobStore.keyPath, 'resourceId');
});

test('4. upgradeDatabaseSchema upgrades v4 database, adding quizAttempts, notes, fileBlobs and preserving existing data', () => {
    // Simulate v4 database with resources, processedContent, learningOutputs, quizzes
    const resStore = new MockObjectStore('resources', { keyPath: 'id' });
    resStore.createIndex('type', 'type', { unique: false });
    resStore.add({ id: 'res-1', title: 'Existing Document' });

    const procStore = new MockObjectStore('processedContent', { keyPath: 'id' });
    procStore.createIndex('resourceId', 'resourceId', { unique: true });
    procStore.add({ id: 'proc-1', resourceId: 'res-1' });

    const loStore = new MockObjectStore('learningOutputs', { keyPath: 'id' });
    loStore.createIndex('resourceId', 'resourceId', { unique: false });

    const quizStore = new MockObjectStore('quizzes', { keyPath: 'id' });
    quizStore.createIndex('resourceId', 'resourceId', { unique: false });

    const db = new MockIDBDatabase([resStore, procStore, loStore, quizStore]);
    const tx = new MockIDBTransaction(db);

    // Old version was 4
    upgradeDatabaseSchema(db, tx, 4);

    // All 7 stores must now exist
    for (const storeName of ALL_REQUIRED_STORES) {
        assert.ok(db.objectStoreNames.contains(storeName), `Missing store: ${storeName}`);
    }

    // Existing records must be preserved
    assert.strictEqual(resStore._records.get('res-1').title, 'Existing Document');
    assert.strictEqual(procStore._records.get('proc-1').resourceId, 'res-1');

    // New stores have proper indexes
    const attemptStore = tx.objectStore(QUIZ_ATTEMPT_STORE);
    QUIZ_ATTEMPT_INDEXES.forEach(({ name }) => {
        assert.ok(attemptStore.indexNames.contains(name));
    });

    const noteStore = tx.objectStore(NOTE_STORE);
    NOTE_INDEXES.forEach(({ name }) => {
        assert.ok(noteStore.indexNames.contains(name));
    });
});

test('5. upgradeDatabaseSchema repairs v7 database missing quizAttempts, notes, fileBlobs', () => {
    // Simulate buggy v7 database where only stores 1-4 existed
    const resStore = new MockObjectStore('resources', { keyPath: 'id' });
    RESOURCE_INDEXES.forEach(({ name, keyPath }) => resStore.createIndex(name, keyPath));
    resStore.add({ id: 'res-old', title: 'Old Study Resource' });

    const procStore = new MockObjectStore('processedContent', { keyPath: 'id' });
    procStore.createIndex('resourceId', 'resourceId', { unique: true });

    const loStore = new MockObjectStore('learningOutputs', { keyPath: 'id' });
    LEARNING_OUTPUT_INDEXES.forEach(({ name, keyPath, unique }) => loStore.createIndex(name, keyPath, { unique }));

    const quizStore = new MockObjectStore('quizzes', { keyPath: 'id' });
    QUIZ_INDEXES.forEach(({ name, keyPath, unique }) => quizStore.createIndex(name, keyPath, { unique }));

    const db = new MockIDBDatabase([resStore, procStore, loStore, quizStore]);
    const tx = new MockIDBTransaction(db);

    // Old version reported as 7!
    upgradeDatabaseSchema(db, tx, 7);

    // Version 8 self-healing migration MUST have created the missing stores
    assert.ok(db.objectStoreNames.contains('quizAttempts'), 'quizAttempts was not repaired');
    assert.ok(db.objectStoreNames.contains('notes'), 'notes was not repaired');
    assert.ok(db.objectStoreNames.contains('fileBlobs'), 'fileBlobs was not repaired');

    // Existing data preserved
    assert.strictEqual(resStore._records.get('res-old').title, 'Old Study Resource');
});

test('6. upgradeDatabaseSchema creates missing indexes on existing stores without error', () => {
    // Simulate database where resources store exists but is missing 'status' index
    const resStore = new MockObjectStore('resources', { keyPath: 'id' });
    resStore.createIndex('type', 'type');
    resStore.createIndex('createdAt', 'createdAt');
    resStore.createIndex('updatedAt', 'updatedAt');
    // Note: status index is missing!

    const db = new MockIDBDatabase([resStore]);
    const tx = new MockIDBTransaction(db);

    upgradeDatabaseSchema(db, tx, 1);

    assert.ok(resStore.indexNames.contains('status'), 'Missing status index was not created');
});

test('7. upgradeDatabaseSchema is idempotent when all stores and indexes already exist', () => {
    const db = new MockIDBDatabase();
    const tx = new MockIDBTransaction(db);

    // First run (fresh v0 -> v8)
    upgradeDatabaseSchema(db, tx, 0);

    // Second run (simulating upgrade on already complete schema)
    assert.doesNotThrow(() => {
        upgradeDatabaseSchema(db, tx, 7);
    });

    for (const storeName of ALL_REQUIRED_STORES) {
        assert.ok(db.objectStoreNames.contains(storeName));
    }
});

test('8. upgradeDatabaseSchema rejects when transaction is missing', () => {
    const db = new MockIDBDatabase();
    assert.throws(() => {
        upgradeDatabaseSchema(db, null, 0);
    }, (err) => {
        return err instanceof StorageError && err.code === 'MIGRATION_TRANSACTION_MISSING';
    });
});

test('9. DatabaseConnection post-open verification rejects with DATABASE_SCHEMA_INCOMPLETE when stores are missing', async () => {
    // Mock factory that returns a database missing 'notes'
    const incompleteDb = new MockIDBDatabase([
        new MockObjectStore('resources', { keyPath: 'id' }),
        new MockObjectStore('processedContent', { keyPath: 'id' }),
        new MockObjectStore('learningOutputs', { keyPath: 'id' }),
        new MockObjectStore('quizzes', { keyPath: 'id' }),
        new MockObjectStore('quizAttempts', { keyPath: 'id' }),
        new MockObjectStore('fileBlobs', { keyPath: 'resourceId' }),
        // Missing: 'notes'
    ]);

    const mockFactory = {
        open() {
            const request = {
                result: incompleteDb,
                transaction: new MockIDBTransaction(incompleteDb),
                error: null,
                addEventListener(event, handler) {
                    if (event === 'success') {
                        setTimeout(() => handler(), 0);
                    }
                },
            };
            return request;
        },
    };

    const connection = new DatabaseConnection({
        indexedDBFactory: mockFactory,
        databaseName: 'TestIncompleteDB',
        version: 9,
    });

    await assert.rejects(async () => {
        await connection.open();
    }, (err) => {
        assert.ok(err instanceof StorageError);
        assert.strictEqual(err.code, 'DATABASE_SCHEMA_INCOMPLETE');
        assert.ok(err.message.includes('notes'));
        return true;
    });
});
