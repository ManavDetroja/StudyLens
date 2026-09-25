import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LEARNING_OUTPUT_TYPES,
    validateLearningOutput,
    createLearningOutputRecord,
    createUpdatedLearningOutput,
} from '../js/storage/learningOutputValidation.js';
import {
    LearningOutputRepository,
    sortByCreatedAt,
} from '../js/storage/learningOutputStore.js';
import { LearningOutputValidationError } from '../js/storage/errors.js';

/* ── Test fixtures (clearly identified for test use only) ────────── */

const FIXED_TIMESTAMP_A = '2026-09-23T00:00:00.000Z';
const FIXED_TIMESTAMP_B = '2026-09-23T00:05:00.000Z';

function makeValidLearningOutputInput(overrides = {}) {
    return {
        resourceId: 'res-test-123',
        type: 'summary',
        content: 'Photosynthesis converts light energy into chemical energy stored in glucose.',
        sourceChunkIds: [0, 1],
        metadata: { wordCount: 10, confidence: 0.95 },
        ...overrides,
    };
}

function makeValidLearningOutputRecord(overrides = {}) {
    return {
        id: 'out-test-001',
        resourceId: 'res-test-123',
        type: 'summary',
        content: 'Photosynthesis converts light energy into chemical energy stored in glucose.',
        sourceChunkIds: [0, 1],
        metadata: { wordCount: 10 },
        createdAt: FIXED_TIMESTAMP_A,
        updatedAt: FIXED_TIMESTAMP_A,
        ...overrides,
    };
}

/** In-memory mock database connection for testing repository logic without browser IndexedDB */
function createMockDatabase() {
    const store = new Map(); // id -> record

    return {
        async open() {
            return {
                objectStoreNames: {
                    contains: (name) => name === 'learningOutputs',
                },
                transaction: (_storeName, _mode) => {
                    const txListeners = { complete: [], error: [], abort: [] };
                    const tx = {
                        addEventListener: (evt, fn) => {
                            if (txListeners[evt]) txListeners[evt].push(fn);
                        },
                        abort: () => {
                            txListeners.abort.forEach((fn) => fn());
                        },
                        objectStore: () => ({
                            add: (record) => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: record.id,
                                };
                                queueMicrotask(() => {
                                    if (store.has(record.id)) {
                                        req.error = { name: 'ConstraintError' };
                                        reqListeners.error.forEach((fn) => fn());
                                    } else {
                                        store.set(record.id, { ...record });
                                        reqListeners.success.forEach((fn) => fn());
                                        txListeners.complete.forEach((fn) => fn());
                                    }
                                });
                                return req;
                            },
                            get: (id) => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: store.get(id) ? { ...store.get(id) } : undefined,
                                };
                                queueMicrotask(() => {
                                    reqListeners.success.forEach((fn) => fn());
                                    txListeners.complete.forEach((fn) => fn());
                                });
                                return req;
                            },
                            put: (record) => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: record.id,
                                };
                                queueMicrotask(() => {
                                    store.set(record.id, { ...record });
                                    reqListeners.success.forEach((fn) => fn());
                                    txListeners.complete.forEach((fn) => fn());
                                });
                                return req;
                            },
                            delete: (id) => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: undefined,
                                };
                                queueMicrotask(() => {
                                    store.delete(id);
                                    reqListeners.success.forEach((fn) => fn());
                                    txListeners.complete.forEach((fn) => fn());
                                });
                                return req;
                            },
                            getAll: () => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: [...store.values()].map((r) => ({ ...r })),
                                };
                                queueMicrotask(() => {
                                    reqListeners.success.forEach((fn) => fn());
                                    txListeners.complete.forEach((fn) => fn());
                                });
                                return req;
                            },
                            count: () => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: store.size,
                                };
                                queueMicrotask(() => {
                                    reqListeners.success.forEach((fn) => fn());
                                    txListeners.complete.forEach((fn) => fn());
                                });
                                return req;
                            },
                            clear: () => {
                                const reqListeners = { success: [], error: [] };
                                const req = {
                                    addEventListener: (evt, fn) => {
                                        if (reqListeners[evt]) reqListeners[evt].push(fn);
                                    },
                                    result: undefined,
                                };
                                queueMicrotask(() => {
                                    store.clear();
                                    reqListeners.success.forEach((fn) => fn());
                                    txListeners.complete.forEach((fn) => fn());
                                });
                                return req;
                            },
                            index: (indexName) => ({
                                getAll: (queryVal) => {
                                    const reqListeners = { success: [], error: [] };
                                    const matches = [...store.values()]
                                        .filter((r) => r[indexName] === queryVal)
                                        .map((r) => ({ ...r }));
                                    const req = {
                                        addEventListener: (evt, fn) => {
                                            if (reqListeners[evt]) reqListeners[evt].push(fn);
                                        },
                                        result: matches,
                                    };
                                    queueMicrotask(() => {
                                        reqListeners.success.forEach((fn) => fn());
                                        txListeners.complete.forEach((fn) => fn());
                                    });
                                    return req;
                                },
                                getAllKeys: (queryVal) => {
                                    const reqListeners = { success: [], error: [] };
                                    const keys = [...store.values()]
                                        .filter((r) => r[indexName] === queryVal)
                                        .map((r) => r.id);
                                    const req = {
                                        addEventListener: (evt, fn) => {
                                            if (reqListeners[evt]) reqListeners[evt].push(fn);
                                        },
                                        result: keys,
                                    };
                                    queueMicrotask(() => {
                                        reqListeners.success.forEach((fn) => fn());
                                        txListeners.complete.forEach((fn) => fn());
                                    });
                                    return req;
                                },
                            }),
                        }),
                    };
                    return tx;
                },
            };
        },
    };
}

/* ── 1. Model Validation ─────────────────────────────────────────── */

test('valid learning output record with text content is accepted', () => {
    const record = makeValidLearningOutputRecord();
    assert.doesNotThrow(() => validateLearningOutput(record));
});

test('valid learning output record with structured object content is accepted', () => {
    const record = makeValidLearningOutputRecord({
        type: 'flashcard',
        content: { front: 'What is photosynthesis?', back: 'Conversion of light to chemical energy' },
        sourceChunkIds: [0],
    });
    assert.doesNotThrow(() => validateLearningOutput(record));
});

test('all supported learning output types are accepted', () => {
    assert.deepEqual(
        LEARNING_OUTPUT_TYPES,
        ['summary', 'notes', 'concept', 'definition', 'question', 'flashcard', 'quiz'],
    );

    LEARNING_OUTPUT_TYPES.forEach((type) => {
        const record = makeValidLearningOutputRecord({ type });
        assert.doesNotThrow(() => validateLearningOutput(record));
    });
});

test('invalid learning output type is rejected', () => {
    const record = makeValidLearningOutputRecord({ type: 'podcast' });
    assert.throws(() => validateLearningOutput(record), /type must be one of/);
});

test('missing or empty resourceId is rejected', () => {
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ resourceId: '' })),
        /resourceId must be a non-empty string/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ resourceId: '   ' })),
        /resourceId must be a non-empty string/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ resourceId: null })),
        /resourceId must be a non-empty string/,
    );
});

test('empty string or empty object content is rejected', () => {
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ content: '' })),
        /content string cannot be empty/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ content: '   ' })),
        /content string cannot be empty/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ content: {} })),
        /content object cannot be empty/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ content: null })),
        /content must be a non-empty string or object/,
    );
});

test('malformed sourceChunkIds are rejected', () => {
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ sourceChunkIds: 'not-array' })),
        /sourceChunkIds must be an array/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ sourceChunkIds: [-1] })),
        /sourceChunkIds elements must be non-negative integers or non-empty strings/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ sourceChunkIds: [''] })),
        /sourceChunkIds elements must be non-negative integers or non-empty strings/,
    );
    assert.throws(
        () => validateLearningOutput(makeValidLearningOutputRecord({ sourceChunkIds: [null] })),
        /sourceChunkIds elements must be non-negative integers or non-empty strings/,
    );
});

test('valid chunk index numbers and string identifiers are accepted for traceability', () => {
    const recordNumber = makeValidLearningOutputRecord({ sourceChunkIds: [0, 1, 2] });
    assert.doesNotThrow(() => validateLearningOutput(recordNumber));

    const recordString = makeValidLearningOutputRecord({ sourceChunkIds: ['chunk-0', 'chunk-1'] });
    assert.doesNotThrow(() => validateLearningOutput(recordString));

    const recordEmpty = makeValidLearningOutputRecord({ sourceChunkIds: [] });
    assert.doesNotThrow(() => validateLearningOutput(recordEmpty));
});

test('createLearningOutputRecord generates UUID, sets timestamps, and trims content', () => {
    const record = createLearningOutputRecord(
        makeValidLearningOutputInput({ content: '  Trimmed summary content  ' }),
        {
            idGenerator: () => 'generated-uuid-1',
            clock: () => new Date(FIXED_TIMESTAMP_A),
        },
    );

    assert.equal(record.id, 'generated-uuid-1');
    assert.equal(record.resourceId, 'res-test-123');
    assert.equal(record.content, 'Trimmed summary content');
    assert.equal(record.createdAt, FIXED_TIMESTAMP_A);
    assert.equal(record.updatedAt, FIXED_TIMESTAMP_A);
});

test('createUpdatedLearningOutput updates mutable fields and advances updatedAt', () => {
    const initial = makeValidLearningOutputRecord();
    const updated = createUpdatedLearningOutput(
        initial,
        {
            content: 'Revised summary content',
            sourceChunkIds: [0, 1, 2],
            metadata: { confidence: 0.99 },
        },
        { clock: () => new Date(FIXED_TIMESTAMP_B) },
    );

    assert.equal(updated.id, initial.id);
    assert.equal(updated.resourceId, initial.resourceId);
    assert.equal(updated.createdAt, initial.createdAt);
    assert.equal(updated.content, 'Revised summary content');
    assert.deepEqual(updated.sourceChunkIds, [0, 1, 2]);
    assert.equal(updated.updatedAt, FIXED_TIMESTAMP_B);
});

test('createUpdatedLearningOutput rejects attempts to change immutable fields', () => {
    const initial = makeValidLearningOutputRecord();

    assert.throws(
        () => createUpdatedLearningOutput(initial, { id: 'new-id' }),
        (err) => err instanceof LearningOutputValidationError && err.code === 'IMMUTABLE_OUTPUT_FIELD',
    );
    assert.throws(
        () => createUpdatedLearningOutput(initial, { resourceId: 'new-res-id' }),
        (err) => err instanceof LearningOutputValidationError && err.code === 'IMMUTABLE_OUTPUT_FIELD',
    );
    assert.throws(
        () => createUpdatedLearningOutput(initial, { createdAt: FIXED_TIMESTAMP_B }),
        (err) => err instanceof LearningOutputValidationError && err.code === 'IMMUTABLE_OUTPUT_FIELD',
    );
});

/* ── 2. Repository Operations ────────────────────────────────────── */

test('repository creates and retrieves learning output by ID', async () => {
    const mockDb = createMockDatabase();
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'output-1',
        clock: () => new Date(FIXED_TIMESTAMP_A),
    });

    const created = await repo.createLearningOutput(makeValidLearningOutputInput());
    assert.equal(created.id, 'output-1');
    assert.equal(created.type, 'summary');

    const retrieved = await repo.getLearningOutput('output-1');
    assert.ok(retrieved !== null);
    assert.equal(retrieved.id, 'output-1');
    assert.equal(retrieved.resourceId, 'res-test-123');
    assert.deepEqual(retrieved.sourceChunkIds, [0, 1]);
});

test('repository retrieves learning outputs by resourceId', async () => {
    const mockDb = createMockDatabase();
    let counter = 0;
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'output-' + (++counter),
        clock: () => new Date(FIXED_TIMESTAMP_A),
    });

    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-A', type: 'summary' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-A', type: 'notes' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-B', type: 'summary' }));

    const resAOutputs = await repo.getLearningOutputsByResourceId('res-A');
    assert.equal(resAOutputs.length, 2);
    assert.ok(resAOutputs.every((o) => o.resourceId === 'res-A'));

    const resBOutputs = await repo.getLearningOutputsByResourceId('res-B');
    assert.equal(resBOutputs.length, 1);
    assert.equal(resBOutputs[0].resourceId, 'res-B');

    const empty = await repo.getLearningOutputsByResourceId('res-nonexistent');
    assert.deepEqual(empty, []);
});

test('repository retrieves learning outputs by type', async () => {
    const mockDb = createMockDatabase();
    let counter = 0;
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'output-' + (++counter),
        clock: () => new Date(FIXED_TIMESTAMP_A),
    });

    await repo.createLearningOutput(makeValidLearningOutputInput({ type: 'question', content: 'What is ATP?' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ type: 'question', content: 'Where is chlorophyll?' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ type: 'summary', content: 'Cell summary' }));

    const questions = await repo.getLearningOutputsByType('question');
    assert.equal(questions.length, 2);
    assert.ok(questions.every((o) => o.type === 'question'));

    const summaries = await repo.getLearningOutputsByType('summary');
    assert.equal(summaries.length, 1);

    await assert.rejects(
        () => repo.getLearningOutputsByType('invalid-type'),
        /Unsupported learning output type/,
    );
});

test('repository updates existing learning output', async () => {
    const mockDb = createMockDatabase();
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'output-update-1',
        clock: () => new Date(FIXED_TIMESTAMP_A),
    });

    await repo.createLearningOutput(makeValidLearningOutputInput());

    const updated = await repo.updateLearningOutput('output-update-1', {
        content: 'Updated summary text',
        sourceChunkIds: [0, 1, 2],
    });

    assert.equal(updated.id, 'output-update-1');
    assert.equal(updated.content, 'Updated summary text');
    assert.deepEqual(updated.sourceChunkIds, [0, 1, 2]);

    const read = await repo.getLearningOutput('output-update-1');
    assert.equal(read.content, 'Updated summary text');
});

test('repository deletes learning output by ID', async () => {
    const mockDb = createMockDatabase();
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'output-del-1',
    });

    await repo.createLearningOutput(makeValidLearningOutputInput());
    assert.ok((await repo.getLearningOutput('output-del-1')) !== null);

    const deleted = await repo.deleteLearningOutput('output-del-1');
    assert.equal(deleted, true);
    assert.equal(await repo.getLearningOutput('output-del-1'), null);

    const deleteAgain = await repo.deleteLearningOutput('output-del-1');
    assert.equal(deleteAgain, false);
});

test('repository deletes all learning outputs for a specific resourceId', async () => {
    const mockDb = createMockDatabase();
    let counter = 0;
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'output-cascade-' + (++counter),
    });

    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-cascade' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-cascade', type: 'flashcard' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-cascade', type: 'quiz' }));
    await repo.createLearningOutput(makeValidLearningOutputInput({ resourceId: 'res-keep', type: 'summary' }));

    assert.equal((await repo.getLearningOutputsByResourceId('res-cascade')).length, 3);
    assert.equal((await repo.getLearningOutputsByResourceId('res-keep')).length, 1);

    const deletedCount = await repo.deleteLearningOutputsByResourceId('res-cascade');
    assert.equal(deletedCount, 3);

    assert.equal((await repo.getLearningOutputsByResourceId('res-cascade')).length, 0);
    // Other resource's outputs are intact
    assert.equal((await repo.getLearningOutputsByResourceId('res-keep')).length, 1);
});

test('repository count and clear methods work as expected', async () => {
    const mockDb = createMockDatabase();
    let counter = 0;
    const repo = new LearningOutputRepository({
        database: mockDb,
        idGenerator: () => 'out-count-' + (++counter),
    });

    assert.equal(await repo.countLearningOutputs(), 0);

    await repo.createLearningOutput(makeValidLearningOutputInput());
    await repo.createLearningOutput(makeValidLearningOutputInput());
    assert.equal(await repo.countLearningOutputs(), 2);

    const clearedCount = await repo.clearLearningOutputs();
    assert.equal(clearedCount, 2);
    assert.equal(await repo.countLearningOutputs(), 0);
});

test('sortByCreatedAt sorts correctly ascending and descending', () => {
    const items = [
        { id: '1', createdAt: '2026-09-23T00:01:00.000Z' },
        { id: '2', createdAt: '2026-09-23T00:03:00.000Z' },
        { id: '3', createdAt: '2026-09-23T00:02:00.000Z' },
    ];

    const desc = sortByCreatedAt(items, 'descending');
    assert.deepEqual(desc.map((i) => i.id), ['2', '3', '1']);

    const asc = sortByCreatedAt(items, 'ascending');
    assert.deepEqual(asc.map((i) => i.id), ['1', '3', '2']);
});
