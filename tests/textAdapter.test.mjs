import test from 'node:test';
import assert from 'node:assert/strict';
import { textAdapter } from '../js/processing/textAdapter.js';

function createResource(overrides = {}) {
    return {
        id: 'resource-1',
        title: 'Adapter test',
        type: 'text',
        source: 'manual://text-entry',
        content: '  First\tparagraph\r\n\r\nSecond paragraph  ',
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:01:00.000Z',
        status: 'completed',
        tags: [],
        metadata: {},
        ...overrides,
    };
}

test('text adapter identifies text resources and extracts their original content', () => {
    const resource = createResource();

    assert.equal(textAdapter.canHandle(resource), true);
    assert.equal(textAdapter.canHandle(createResource({ type: 'pdf' })), false);
    assert.equal(textAdapter.extract(resource), resource.content);
});

test('text adapter returns a normalized content model without segments', () => {
    const resource = createResource();
    const normalized = textAdapter.normalize(textAdapter.extract(resource), resource);

    assert.deepEqual(normalized, {
        resourceId: 'resource-1',
        sourceType: 'text',
        text: 'First paragraph\n\nSecond paragraph',
        segments: [],
        createdAt: '2026-09-21T00:01:00.000Z',
        metadata: { adapterId: 'text' },
    });
});

test('text adapter rejects unsupported resources and missing content', () => {
    assert.throws(
        () => textAdapter.extract(createResource({ type: 'pdf' })),
        { code: 'UNSUPPORTED_RESOURCE_TYPE' },
    );
    assert.throws(
        () => textAdapter.extract(createResource({ content: null })),
        { code: 'RESOURCE_CONTENT_MISSING' },
    );
});
