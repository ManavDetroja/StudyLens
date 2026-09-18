import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createResourceRecord,
    createUpdatedResource,
    validateResource,
} from '../js/storage/resourceValidation.js';

const firstTimestamp = '2026-09-18T00:00:00.000Z';
const secondTimestamp = '2026-09-18T00:01:00.000Z';

function createValidResource(overrides = {}) {
    return {
        id: 'resource-1',
        title: 'Biology chapter',
        type: 'text',
        source: 'manual://biology-chapter',
        content: 'Cell structure overview',
        createdAt: firstTimestamp,
        updatedAt: firstTimestamp,
        status: 'pending',
        tags: ['biology'],
        metadata: {},
        ...overrides,
    };
}

test('creates a normalized resource with a generated stable identifier', () => {
    const resource = createResourceRecord({
        title: '  Biology chapter  ',
        type: 'text',
        source: 'manual://biology-chapter',
        tags: ['biology', 'biology'],
        metadata: { subject: 'science' },
    }, {
        idGenerator: () => 'resource-1',
        clock: () => new Date(firstTimestamp),
    });

    assert.equal(resource.id, 'resource-1');
    assert.equal(resource.title, 'Biology chapter');
    assert.equal(resource.status, 'pending');
    assert.deepEqual(resource.tags, ['biology']);
    assert.equal(resource.createdAt, firstTimestamp);
    assert.equal(resource.updatedAt, firstTimestamp);
});

test('updates mutable fields while preserving the id and created timestamp', () => {
    const resource = createUpdatedResource(createValidResource(), {
        title: 'Biology chapter 1',
        status: 'completed',
        tags: ['biology', 'revision'],
    }, {
        clock: () => new Date(secondTimestamp),
    });

    assert.equal(resource.id, 'resource-1');
    assert.equal(resource.createdAt, firstTimestamp);
    assert.equal(resource.updatedAt, secondTimestamp);
    assert.equal(resource.status, 'completed');
    assert.deepEqual(resource.tags, ['biology', 'revision']);
});

test('rejects invalid resources and immutable update fields', () => {
    assert.throws(
        () => validateResource(createValidResource({ title: '', status: 'unknown' })),
        /title must be a non-empty string/,
    );
    assert.throws(
        () => createUpdatedResource(createValidResource(), { id: 'resource-2' }),
        /cannot be changed/,
    );
    assert.throws(
        () => createResourceRecord({
            title: 'Incomplete',
            type: 'audio',
            source: 'manual://incomplete',
        }, {
            idGenerator: () => 'resource-2',
            clock: () => new Date(firstTimestamp),
        }),
        /type must be video, pdf, image, or text/,
    );
});
