import test from 'node:test';
import assert from 'node:assert/strict';
import {
    searchResources,
    filterByType,
    filterByStatus,
    filterByTag,
    sortResources,
    applyLibraryFilters,
    isFiltered,
} from '../js/algorithms/librarySearch.js';

/* ── Test fixtures ───────────────────────────────────────────────── */

function makeResource(overrides = {}) {
    return {
        id: 'r0',
        title: 'Default Title',
        type: 'text',
        source: 'manual://text-entry',
        content: 'Default content',
        createdAt: '2026-09-18T00:00:00.000Z',
        updatedAt: '2026-09-18T00:00:00.000Z',
        status: 'completed',
        tags: [],
        metadata: {},
        ...overrides,
    };
}

const fixtures = [
    makeResource({
        id: 'r1',
        title: 'Java inheritance and polymorphism',
        content: 'A subclass inherits from its parent class.',
        tags: ['java', 'oop'],
        type: 'text',
        createdAt: '2026-09-18T00:01:00.000Z',
        updatedAt: '2026-09-18T00:02:00.000Z',
        status: 'completed',
    }),
    makeResource({
        id: 'r2',
        title: 'Python basics',
        content: 'Python is a high-level programming language.',
        tags: ['python'],
        type: 'text',
        createdAt: '2026-09-18T00:02:00.000Z',
        updatedAt: '2026-09-18T00:03:00.000Z',
        status: 'completed',
    }),
    makeResource({
        id: 'r3',
        title: 'Biology notes',
        content: 'Cell division overview.',
        tags: ['biology'],
        type: 'pdf',
        createdAt: '2026-09-18T00:03:00.000Z',
        updatedAt: '2026-09-18T00:03:00.000Z',
        status: 'pending',
    }),
    makeResource({
        id: 'r4',
        title: 'Physics lecture',
        content: null,
        tags: [],
        type: 'video',
        createdAt: '2026-09-18T00:04:00.000Z',
        updatedAt: '2026-09-18T00:05:00.000Z',
        status: 'processing',
    }),
    makeResource({
        id: 'r5',
        title: 'Chemistry diagram',
        content: 'Periodic table summary.',
        tags: ['chemistry'],
        type: 'image',
        createdAt: '2026-09-18T00:05:00.000Z',
        updatedAt: '2026-09-18T00:05:00.000Z',
        status: 'failed',
    }),
];

/* ── Search tests ────────────────────────────────────────────────── */

test('search finds resources by title match', () => {
    const results = searchResources(fixtures, 'inheritance');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
});

test('search finds resources by content match', () => {
    const results = searchResources(fixtures, 'high-level');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r2');
});

test('search finds resources by tag match', () => {
    const results = searchResources(fixtures, 'biology');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r3');
});

test('search is case-insensitive', () => {
    const results = searchResources(fixtures, 'JAVA');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
});

test('search handles mixed case in content', () => {
    const results = searchResources(fixtures, 'python');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r2');
});

test('empty query returns all resources', () => {
    assert.equal(searchResources(fixtures, '').length, 5);
    assert.equal(searchResources(fixtures, '   ').length, 5);
});

test('search with no matches returns empty array', () => {
    const results = searchResources(fixtures, 'quantum mechanics');
    assert.equal(results.length, 0);
});

test('search handles resources with null content', () => {
    const results = searchResources(fixtures, 'Physics');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r4');
});

test('search normalizes whitespace in query', () => {
    const results = searchResources(fixtures, '  cell   division  ');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r3');
});

/* ── Type filter tests ───────────────────────────────────────────── */

test('filters by text type', () => {
    const results = filterByType(fixtures, 'text');
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.type === 'text'));
});

test('filters by pdf type', () => {
    const results = filterByType(fixtures, 'pdf');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r3');
});

test('filters by image type', () => {
    const results = filterByType(fixtures, 'image');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r5');
});

test('filters by video type', () => {
    const results = filterByType(fixtures, 'video');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r4');
});

test('all types returns all resources', () => {
    assert.equal(filterByType(fixtures, 'all').length, 5);
    assert.equal(filterByType(fixtures, '').length, 5);
});

/* ── Status filter tests ─────────────────────────────────────────── */

test('filters by pending status', () => {
    const results = filterByStatus(fixtures, 'pending');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r3');
});

test('filters by processing status', () => {
    const results = filterByStatus(fixtures, 'processing');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r4');
});

test('filters by completed status', () => {
    const results = filterByStatus(fixtures, 'completed');
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.status === 'completed'));
});

test('filters by failed status', () => {
    const results = filterByStatus(fixtures, 'failed');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r5');
});

test('all statuses returns all resources', () => {
    assert.equal(filterByStatus(fixtures, 'all').length, 5);
    assert.equal(filterByStatus(fixtures, '').length, 5);
});

/* ── Sorting tests ───────────────────────────────────────────────── */

test('sorts newest first by createdAt descending', () => {
    const sorted = sortResources(fixtures, 'recent');
    assert.deepEqual(sorted.map((r) => r.id), ['r5', 'r4', 'r3', 'r2', 'r1']);
});

test('sorts oldest first by createdAt ascending', () => {
    const sorted = sortResources(fixtures, 'oldest');
    assert.deepEqual(sorted.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
});

test('sorts title A–Z case-insensitively', () => {
    const sorted = sortResources(fixtures, 'title-az');
    assert.deepEqual(sorted.map((r) => r.id), ['r3', 'r5', 'r1', 'r4', 'r2']);
});

test('sorts title Z–A case-insensitively', () => {
    const sorted = sortResources(fixtures, 'title-za');
    assert.deepEqual(sorted.map((r) => r.id), ['r2', 'r4', 'r1', 'r5', 'r3']);
});

test('sorts recently updated by updatedAt descending', () => {
    const sorted = sortResources(fixtures, 'updated');
    assert.deepEqual(sorted.map((r) => r.id), ['r4', 'r5', 'r2', 'r3', 'r1']);
});

test('unknown sort key defaults to newest first', () => {
    const sorted = sortResources(fixtures, 'unknown');
    assert.deepEqual(sorted.map((r) => r.id), ['r5', 'r4', 'r3', 'r2', 'r1']);
});

/* ── Combined filter tests ───────────────────────────────────────── */

test('combined search + type + status + sort works together', () => {
    const results = applyLibraryFilters(fixtures, {
        query: '',
        type: 'text',
        status: 'completed',
        sort: 'title-az',
    });
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.id), ['r1', 'r2']);
});

test('combined search narrows within type and status filter', () => {
    const results = applyLibraryFilters(fixtures, {
        query: 'java',
        type: 'text',
        status: 'completed',
        sort: 'recent',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
});

test('combined filters produce zero results when nothing matches', () => {
    const results = applyLibraryFilters(fixtures, {
        query: 'java',
        type: 'pdf',
        status: 'completed',
        sort: 'recent',
    });
    assert.equal(results.length, 0);
});

test('default filters return all resources sorted newest first', () => {
    const results = applyLibraryFilters(fixtures);
    assert.equal(results.length, 5);
    assert.deepEqual(results.map((r) => r.id), ['r5', 'r4', 'r3', 'r2', 'r1']);
});

/* ── Tag filter tests ────────────────────────────────────────────── */

test('filters by matching tag', () => {
    const results = filterByTag(fixtures, 'java');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
});

test('filters by tag case-insensitively', () => {
    const results = filterByTag(fixtures, 'BIOLOGY');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r3');
});

test('tag filter does not match partial tags', () => {
    const results = filterByTag(fixtures, 'bio');
    assert.equal(results.length, 0);
});

test('tag all returns all resources', () => {
    assert.equal(filterByTag(fixtures, 'all').length, 5);
    assert.equal(filterByTag(fixtures, '').length, 5);
});

test('tag filter handles resources with no tags', () => {
    const results = filterByTag(fixtures, 'java');
    assert.ok(results.every((r) => r.tags.some((t) => t.toLowerCase() === 'java')));
});

test('combined tag + search filters', () => {
    const results = applyLibraryFilters(fixtures, {
        query: 'inheritance',
        tag: 'java',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
});

test('combined tag + type filters', () => {
    const results = applyLibraryFilters(fixtures, {
        type: 'text',
        tag: 'oop',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
});

test('combined tag + status filters', () => {
    const results = applyLibraryFilters(fixtures, {
        status: 'completed',
        tag: 'python',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r2');
});

test('tag filter produces zero results for non-existent tag', () => {
    const results = filterByTag(fixtures, 'nonexistent');
    assert.equal(results.length, 0);
});

/* ── isFiltered tests ────────────────────────────────────────────── */

test('detects active search filter', () => {
    assert.equal(isFiltered({ query: 'java', type: 'all', status: 'all', tag: 'all' }), true);
});

test('detects active type filter', () => {
    assert.equal(isFiltered({ query: '', type: 'text', status: 'all', tag: 'all' }), true);
});

test('detects active status filter', () => {
    assert.equal(isFiltered({ query: '', type: 'all', status: 'pending', tag: 'all' }), true);
});

test('detects active tag filter', () => {
    assert.equal(isFiltered({ query: '', type: 'all', status: 'all', tag: 'java' }), true);
});

test('detects no active filters', () => {
    assert.equal(isFiltered({ query: '', type: 'all', status: 'all', tag: 'all' }), false);
    assert.equal(isFiltered({ query: '   ', type: 'all', status: 'all', tag: 'all' }), false);
    assert.equal(isFiltered(), false);
});

/* ── Empty input array ───────────────────────────────────────────── */

test('all functions handle empty resource arrays', () => {
    assert.deepEqual(searchResources([], 'test'), []);
    assert.deepEqual(filterByType([], 'text'), []);
    assert.deepEqual(filterByStatus([], 'completed'), []);
    assert.deepEqual(filterByTag([], 'java'), []);
    assert.deepEqual(sortResources([], 'recent'), []);
    assert.deepEqual(applyLibraryFilters([], { query: 'test', type: 'text', tag: 'java' }), []);
});
