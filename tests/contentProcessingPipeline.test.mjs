import test from 'node:test';
import assert from 'node:assert/strict';
import { processResource } from '../js/processing/contentProcessingPipeline.js';

function createResource(overrides = {}) {
    return {
        id: 'resource-1',
        title: 'Pipeline test',
        type: 'text',
        source: 'manual://text-entry',
        content: '  First paragraph.\r\n\r\nSecond paragraph.  ',
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:01:00.000Z',
        status: 'completed',
        tags: ['test'],
        metadata: {},
        ...overrides,
    };
}

test('pipeline validates, extracts, normalizes, and chunks a text resource', async () => {
    const result = await processResource(createResource(), {
        chunking: { maxChunkSize: 18 },
    });

    assert.equal(result.resourceId, 'resource-1');
    assert.equal(result.sourceType, 'text');
    assert.equal(result.text, 'First paragraph.\n\nSecond paragraph.');
    assert.equal(result.createdAt, '2026-09-21T00:01:00.000Z');
    assert.deepEqual(result.metadata, { adapterId: 'text' });
    assert.ok(result.segments.every((segment) => segment.text.length <= 18));
    assert.equal(result.segments.map((segment) => segment.text).join(''), result.text);
});

test('pipeline reports an unsupported but otherwise valid resource type', async () => {
    await assert.rejects(
        () => processResource(createResource({
            type: 'pdf',
            content: 'A PDF would require a future adapter.',
            status: 'pending',
        })),
        { code: 'UNSUPPORTED_RESOURCE_TYPE' },
    );
});

test('pipeline reports missing manual text content', async () => {
    await assert.rejects(
        () => processResource(createResource({ content: null })),
        { code: 'RESOURCE_CONTENT_MISSING' },
    );
});

test('pipeline rejects an invalid resource before selecting an adapter', async () => {
    await assert.rejects(
        () => processResource(createResource({ title: '' })),
        { code: 'PROCESSING_INVALID_RESOURCE' },
    );
});
