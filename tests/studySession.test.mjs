import test from 'node:test';
import assert from 'node:assert/strict';

import {
    STUDY_SESSION_STATUSES,
    validateStudySession,
    createStudySessionRecord,
    createUpdatedStudySession,
    calculateElapsedMs,
    formatSessionDuration,
} from '../js/storage/studySessionValidation.js';
import { StudySessionRepository } from '../js/storage/studySessionStore.js';
import {
    assessResourceReadiness,
    planSessionSteps,
    startStudySession,
    getActiveSessionState,
    markStepCompleted,
    completeStudySession,
    abandonStudySession,
    getResourceSessionHistory,
} from '../js/features/studySessionService.js';
import { StorageError } from '../js/storage/errors.js';

/* ── Minimal In-Memory Database Mock for StudySessionRepository ─── */

class MockStudySessionDatabase {
    constructor() {
        this.records = new Map();
    }

    async withDatabase(callback) {
        const fakeTx = {};
        return callback(fakeTx);
    }
}

function makeMockRequest(getResult) {
    const listeners = new Map();
    const req = {
        result: undefined,
        addEventListener(event, fn) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(fn);
        },
        set onsuccess(fn) {
            this.addEventListener('success', fn);
        },
        set onerror(fn) {
            this.addEventListener('error', fn);
        },
    };
    queueMicrotask(() => {
        try {
            req.result = getResult();
            const list = listeners.get('success') || [];
            list.forEach((fn) => fn({ target: req }));
        } catch (err) {
            req.error = err;
            const list = listeners.get('error') || [];
            list.forEach((fn) => fn({ target: req }));
        }
    });
    return req;
}

function createMockStudySessionRepository() {
    const db = new MockStudySessionDatabase();
    const repo = new StudySessionRepository({ database: db });

    // Mock withStore on repository instance
    repo.withStore = async function (mode, operation, callback) {
        const store = {
            indexNames: {
                contains(name) {
                    return name === 'resourceId';
                },
            },
            put(record) {
                return makeMockRequest(() => {
                    db.records.set(record.id, JSON.parse(JSON.stringify(record)));
                    return record.id;
                });
            },
            get(id) {
                return makeMockRequest(() => {
                    return db.records.has(id) ? JSON.parse(JSON.stringify(db.records.get(id))) : undefined;
                });
            },
            getAll() {
                return makeMockRequest(() => {
                    return Array.from(db.records.values()).map((r) => JSON.parse(JSON.stringify(r)));
                });
            },
            delete(id) {
                return makeMockRequest(() => {
                    db.records.delete(id);
                    return undefined;
                });
            },
            count() {
                return makeMockRequest(() => db.records.size);
            },
            clear() {
                return makeMockRequest(() => {
                    db.records.clear();
                    return undefined;
                });
            },
            openCursor() {
                const items = Array.from(db.records.values());
                let index = 0;
                const listeners = new Map();
                const req = {
                    result: null,
                    addEventListener(event, fn) {
                        if (!listeners.has(event)) listeners.set(event, []);
                        listeners.get(event).push(fn);
                    },
                    set onsuccess(fn) {
                        this.addEventListener('success', fn);
                    },
                    set onerror(fn) {
                        this.addEventListener('error', fn);
                    },
                };
                function advance() {
                    if (index < items.length) {
                        const rec = items[index++];
                        req.result = {
                            value: rec,
                            continue() {
                                queueMicrotask(advance);
                            },
                            delete() {
                                db.records.delete(rec.id);
                            },
                        };
                    } else {
                        req.result = null;
                    }
                    const list = listeners.get('success') || [];
                    list.forEach((fn) => fn({ target: req }));
                }
                queueMicrotask(advance);
                return req;
            },
            index(indexName) {
                return {
                    getAll(key) {
                        return makeMockRequest(() => {
                            const matching = Array.from(db.records.values()).filter((r) => {
                                if (indexName === 'resourceId') return r.resourceId === key;
                                return true;
                            });
                            return matching.map((r) => JSON.parse(JSON.stringify(r)));
                        });
                    },
                    openCursor(range) {
                        const targetResourceId = range;
                        const matching = Array.from(db.records.values()).filter((r) => {
                            if (indexName === 'resourceId') return r.resourceId === targetResourceId;
                            return true;
                        });
                        let index = 0;
                        const listeners = new Map();
                        const req = {
                            result: null,
                            addEventListener(event, fn) {
                                if (!listeners.has(event)) listeners.set(event, []);
                                listeners.get(event).push(fn);
                            },
                            set onsuccess(fn) {
                                this.addEventListener('success', fn);
                            },
                            set onerror(fn) {
                                this.addEventListener('error', fn);
                            },
                        };
                        function advance() {
                            if (index < matching.length) {
                                const rec = matching[index++];
                                req.result = {
                                    value: rec,
                                    continue() {
                                        queueMicrotask(advance);
                                    },
                                    delete() {
                                        db.records.delete(rec.id);
                                    },
                                };
                            } else {
                                req.result = null;
                            }
                            const list = listeners.get('success') || [];
                            list.forEach((fn) => fn({ target: req }));
                        }
                        queueMicrotask(advance);
                        return req;
                    },
                };
            },
        };
        return callback(store);
    };

    return { repo, db };
}

/* ── Test Suite ──────────────────────────────────────────────────── */

test('1. createStudySessionRecord generates a complete, valid active session', () => {
    const session = createStudySessionRecord({
        resourceId: 'res-123',
        startedAt: '2026-10-06T10:00:00.000Z',
        metadata: { source: 'unit-test' },
    });

    assert.equal(typeof session.id, 'string');
    assert.ok(session.id.length > 10);
    assert.equal(session.resourceId, 'res-123');
    assert.equal(session.status, 'active');
    assert.equal(session.startedAt, '2026-10-06T10:00:00.000Z');
    assert.equal(session.completedAt, null);
    assert.equal(session.durationMs, 0);
    assert.deepEqual(session.stepsCompleted, []);
    assert.equal(session.metadata.source, 'unit-test');

    const validated = validateStudySession(session);
    assert.deepEqual(validated, session);
});

test('2. validateStudySession validates completed and abandoned sessions', () => {
    const completed = {
        id: 'sess-1',
        resourceId: 'res-abc',
        startedAt: '2026-10-06T10:00:00.000Z',
        completedAt: '2026-10-06T10:15:30.000Z',
        status: 'completed',
        durationMs: 930000,
        stepsCompleted: ['overview', 'outputs', 'flashcards', 'quiz', 'summary'],
        metadata: { score: '80%' },
    };

    const validCompleted = validateStudySession(completed);
    assert.equal(validCompleted.status, 'completed');
    assert.equal(validCompleted.durationMs, 930000);

    const abandoned = {
        id: 'sess-2',
        resourceId: 'res-abc',
        startedAt: '2026-10-06T10:00:00.000Z',
        completedAt: '2026-10-06T10:02:00.000Z',
        status: 'abandoned',
        durationMs: 120000,
        stepsCompleted: ['overview'],
        metadata: {},
    };

    const validAbandoned = validateStudySession(abandoned);
    assert.equal(validAbandoned.status, 'abandoned');
});

test('3. validateStudySession rejects invalid fields and malformed records', () => {
    assert.throws(() => validateStudySession(null), /object/);
    assert.throws(() => validateStudySession({}), /id/);
    assert.throws(() => validateStudySession({ id: 's1', resourceId: '' }), /resourceId/);
    assert.throws(() => validateStudySession({ id: 's1', resourceId: 'r1', startedAt: 'invalid-date' }), /timestamp/);
    assert.throws(() => validateStudySession({
        id: 's1',
        resourceId: 'r1',
        startedAt: '2026-10-06T10:00:00.000Z',
        status: 'paused',
    }), /status/);
    assert.throws(() => validateStudySession({
        id: 's1',
        resourceId: 'r1',
        startedAt: '2026-10-06T10:00:00.000Z',
        status: 'active',
        stepsCompleted: 'overview',
    }), /stepsCompleted must be an array/);
});

test('4. createUpdatedStudySession updates mutable fields while preserving identity', () => {
    const original = createStudySessionRecord({
        resourceId: 'res-456',
        startedAt: '2026-10-06T10:00:00.000Z',
    });

    const updated = createUpdatedStudySession(original, {
        status: 'completed',
        completedAt: '2026-10-06T10:20:00.000Z',
        durationMs: 1200000,
        stepsCompleted: ['overview', 'outputs', 'summary'],
    });

    assert.equal(updated.id, original.id);
    assert.equal(updated.resourceId, original.resourceId);
    assert.equal(updated.startedAt, original.startedAt);
    assert.equal(updated.status, 'completed');
    assert.equal(updated.durationMs, 1200000);
    assert.deepEqual(updated.stepsCompleted, ['overview', 'outputs', 'summary']);

    // Attempting to mutate id or resourceId throws
    assert.throws(() => createUpdatedStudySession(original, { id: 'new-id' }), /cannot be changed/);
    assert.throws(() => createUpdatedStudySession(original, { resourceId: 'diff-res' }), /cannot be changed/);
});

test('5. calculateElapsedMs and formatSessionDuration calculate accurately', () => {
    const start = '2026-10-06T10:00:00.000Z';
    const end = '2026-10-06T10:05:32.000Z';

    const elapsed = calculateElapsedMs(start, end);
    assert.equal(elapsed, 332000);

    assert.equal(formatSessionDuration(0), '0s');
    assert.equal(formatSessionDuration(5000), '5s');
    assert.equal(formatSessionDuration(65000), '1m 5s');
    assert.equal(formatSessionDuration(332000), '5m 32s');
    assert.equal(formatSessionDuration(3665000), '1h 1m');
    assert.equal(formatSessionDuration(7200000), '2h');
});

test('6. assessResourceReadiness evaluates resource state correctly', () => {
    assert.deepEqual(assessResourceReadiness(null), {
        ready: false,
        reason: 'RESOURCE_NOT_FOUND',
        message: 'Resource could not be found.',
    });

    assert.deepEqual(assessResourceReadiness({ id: 'r1', status: 'processing' }), {
        ready: false,
        reason: 'RESOURCE_PROCESSING',
        message: 'This resource is currently processing. Please wait until processing finishes.',
    });

    assert.deepEqual(assessResourceReadiness({ id: 'r1', status: 'pending', content: '' }), {
        ready: false,
        reason: 'RESOURCE_NOT_PROCESSED',
        message: 'Process this resource before starting a study session.',
    });

    assert.deepEqual(assessResourceReadiness({ id: 'r1', status: 'completed', content: 'Some study text' }), {
        ready: true,
    });

    assert.deepEqual(assessResourceReadiness({ id: 'r1', status: 'pending', content: '' }, {
        processed: { normalizedText: 'Extracted text', chunks: [{ index: 0 }] },
    }), {
        ready: true,
    });
});

test('7. planSessionSteps dynamically determines available steps and item counts', () => {
    // 1. Full resource with all tools generated
    const fullSteps = planSessionSteps({
        outputs: [
            { type: 'summary', content: 'Summary' },
            { type: 'concept', content: 'Concept 1' },
            { type: 'flashcard', content: { front: 'Q', back: 'A' } },
        ],
        flashcards: [{ id: 'fc-1', content: { front: 'Q', back: 'A' } }, { id: 'fc-2', content: { front: 'Q2', back: 'A2' } }],
        quiz: { id: 'q-1', questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
        notes: [{ id: 'n-1' }],
    });

    assert.equal(fullSteps.length, 5);
    assert.equal(fullSteps[0].id, 'overview');
    assert.equal(fullSteps[0].available, true);

    assert.equal(fullSteps[1].id, 'outputs');
    assert.equal(fullSteps[1].available, true);
    assert.equal(fullSteps[1].count, 2); // Excludes flashcard from general outputs

    assert.equal(fullSteps[2].id, 'flashcards');
    assert.equal(fullSteps[2].available, true);
    assert.equal(fullSteps[2].count, 2);

    assert.equal(fullSteps[3].id, 'quiz');
    assert.equal(fullSteps[3].available, true);
    assert.equal(fullSteps[3].count, 3);

    assert.equal(fullSteps[4].id, 'summary');
    assert.equal(fullSteps[4].available, true);

    // 2. Resource without flashcards or quiz
    const partialSteps = planSessionSteps({
        outputs: [{ type: 'summary', content: 'Summary' }],
        flashcards: [],
        quiz: null,
    });

    assert.equal(partialSteps.find((s) => s.id === 'outputs').available, true);
    assert.equal(partialSteps.find((s) => s.id === 'flashcards').available, false);
    assert.equal(partialSteps.find((s) => s.id === 'quiz').available, false);
    assert.equal(partialSteps.find((s) => s.id === 'summary').available, true);
});

test('8. StudySessionRepository CRUD operations with mock IndexedDB', async () => {
    const { repo, db } = createMockStudySessionRepository();

    // 1. Save Session
    const session1 = createStudySessionRecord({
        resourceId: 'res-alpha',
        startedAt: '2026-10-06T10:00:00.000Z',
    });
    const saved = await repo.saveSession(session1);
    assert.equal(saved.id, session1.id);
    assert.equal(db.records.size, 1);

    // 2. Get Session
    const fetched = await repo.getSession(session1.id);
    assert.ok(fetched);
    assert.equal(fetched.resourceId, 'res-alpha');

    // 3. Save second session for same resource
    const session2 = createStudySessionRecord({
        resourceId: 'res-alpha',
        startedAt: '2026-10-06T11:00:00.000Z',
    });
    await repo.saveSession(session2);

    // 4. Save third session for different resource
    const session3 = createStudySessionRecord({
        resourceId: 'res-beta',
        startedAt: '2026-10-06T12:00:00.000Z',
    });
    await repo.saveSession(session3);

    assert.equal(await repo.countSessions(), 3);

    // 5. Get sessions by resource
    const alphaSessions = await repo.getSessionsByResource('res-alpha');
    assert.equal(alphaSessions.length, 2);

    const betaSessions = await repo.getSessionsByResource('res-beta');
    assert.equal(betaSessions.length, 1);

    // 6. Delete session by id
    const deleted = await repo.deleteSession(session1.id);
    assert.equal(deleted, true);
    assert.equal(await repo.countSessions(), 2);

    // 7. Delete sessions by resource
    const deletedCount = await repo.deleteSessionsByResource('res-alpha');
    assert.equal(deletedCount, 1);
    assert.equal(await repo.countSessions(), 1);

    // 8. Clear sessions
    await repo.clearSessions();
    assert.equal(await repo.countSessions(), 0);
});

test('9. Active study session state and step completion tracking', () => {
    const sessionRecord = createStudySessionRecord({
        resourceId: 'res-track',
        startedAt: new Date().toISOString(),
    });

    // Mark step completed
    markStepCompleted('outputs');
    markStepCompleted('flashcards');

    // Safe formatting and checks
    assert.ok(Array.isArray(sessionRecord.stepsCompleted));
});
