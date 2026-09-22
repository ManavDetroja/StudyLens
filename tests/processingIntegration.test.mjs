import test from 'node:test';
import assert from 'node:assert/strict';
import {
    processAndStore,
    processResourceById,
    getProcessedContent,
    deleteProcessedContent,
    isProcessingError,
} from '../js/features/processingIntegration.js';
import { ContentProcessingError } from '../js/processing/errors.js';

/* ── Test helpers and in-memory mock repositories ─────────────────── */

function createMockResourceRepository() {
    const store = new Map();

    return {
        async getResource(id) {
            return store.get(id) ? { ...store.get(id) } : null;
        },
        async createResource(resource) {
            store.set(resource.id, { ...resource });
            return { ...resource };
        },
        async updateResource(id, updates) {
            const existing = store.get(id);
            if (!existing) throw new Error('Resource not found');
            const updated = {
                ...existing,
                ...updates,
                metadata: { ...(existing.metadata || {}), ...(updates.metadata || {}) },
                updatedAt: new Date().toISOString(),
            };
            store.set(id, updated);
            return { ...updated };
        },
        async deleteResource(id) {
            return store.delete(id);
        },
        getAll() {
            return [...store.values()];
        },
    };
}

function createMockProcessedContentRepository() {
    const store = new Map(); // keyed by id
    const resourceIdIndex = new Map(); // resourceId -> id

    return {
        async saveProcessedContent(processedContent) {
            if (!processedContent || !processedContent.resourceId) {
                throw new Error('Processed content must include a resourceId.');
            }

            // Remove any existing for this resourceId
            const existingId = resourceIdIndex.get(processedContent.resourceId);
            if (existingId) {
                store.delete(existingId);
                resourceIdIndex.delete(processedContent.resourceId);
            }

            const record = {
                id: processedContent.id ?? 'proc-' + Math.random().toString(36).slice(2),
                resourceId: processedContent.resourceId,
                normalizedText: processedContent.text ?? '',
                chunks: processedContent.segments ?? [],
                sourceType: processedContent.sourceType ?? 'text',
                metadata: processedContent.metadata ?? {},
                createdAt: processedContent.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            store.set(record.id, record);
            resourceIdIndex.set(record.resourceId, record.id);
            return { ...record };
        },
        async getByResourceId(resourceId) {
            const id = resourceIdIndex.get(resourceId);
            if (!id) return null;
            return store.get(id) ? { ...store.get(id) } : null;
        },
        async deleteByResourceId(resourceId) {
            const id = resourceIdIndex.get(resourceId);
            if (!id) return false;
            store.delete(id);
            resourceIdIndex.delete(resourceId);
            return true;
        },
        async count() {
            return store.size;
        },
    };
}

function makeValidTextResource(overrides = {}) {
    return {
        id: 'resource-test-1',
        title: 'Photosynthesis overview',
        type: 'text',
        source: 'manual://text-entry',
        content: 'Light-dependent reactions occur in the thylakoid membrane.\r\n\r\nCarbon fixation occurs in the stroma.',
        createdAt: '2026-09-22T10:00:00.000Z',
        updatedAt: '2026-09-22T10:00:00.000Z',
        status: 'completed',
        tags: ['biology', 'photosynthesis'],
        metadata: { entryMethod: 'manual' },
        ...overrides,
    };
}

/* ── 1. Creation and processing ───────────────────────────────────── */

test('creating a valid Text Resource can be processed and stored', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource();
    await resRepo.createResource(resource);

    const processed = await processAndStore(resource, { resRepo, processedRepo });

    assert.ok(processed.id);
    assert.equal(processed.resourceId, resource.id);
    assert.equal(processed.sourceType, 'text');
    assert.ok(Array.isArray(processed.chunks));
    assert.ok(processed.chunks.length > 0);
});

test('processed content is generated and can be retrieved by resourceId', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource();
    await resRepo.createResource(resource);

    await processAndStore(resource, { resRepo, processedRepo });
    const retrieved = await getProcessedContent(resource.id, processedRepo);

    assert.ok(retrieved !== null);
    assert.equal(retrieved.resourceId, resource.id);
    assert.equal(retrieved.sourceType, 'text');
    assert.ok(retrieved.normalizedText.includes('Light-dependent reactions'));
    assert.ok(retrieved.normalizedText.includes('Carbon fixation'));
});

/* ── 2. Normalization verification ────────────────────────────────── */

test('normalized content matches Day 7 behavior (CRLF, tabs, spacing)', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource({
        content: ' \r\n  First\t\tline  \r\n \r\n\r\n Second   paragraph  \r\n ',
    });

    const processed = await processAndStore(resource, { resRepo, processedRepo });

    assert.equal(processed.normalizedText, 'First line\n\nSecond paragraph');
});

/* ── 3. Chunking verification ─────────────────────────────────────── */

test('chunks are generated, ordered, contiguous, and preserve source content', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource({
        content: 'Paragraph 1: Introduction to genetics.\n\nParagraph 2: Mendel studied pea plants.\n\nParagraph 3: DNA double helix structure.',
    });

    const processed = await processAndStore(resource, { resRepo, processedRepo });

    assert.ok(processed.chunks.length >= 1);
    // Index ordering
    processed.chunks.forEach((chunk, idx) => {
        assert.equal(chunk.index, idx);
        assert.ok(typeof chunk.startOffset === 'number');
        assert.ok(typeof chunk.endOffset === 'number');
        assert.ok(chunk.endOffset >= chunk.startOffset);
    });

    // Contiguity
    for (let i = 1; i < processed.chunks.length; i++) {
        assert.equal(processed.chunks[i].startOffset, processed.chunks[i - 1].endOffset);
    }

    // Full coverage without loss
    const reconstructed = processed.chunks.map((c) => c.text).join('');
    assert.equal(reconstructed, processed.normalizedText);
});

/* ── 4. Persistence model verification ────────────────────────────── */

test('processed content record contains all required fields with proper types', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource();

    const processed = await processAndStore(resource, { resRepo, processedRepo });

    assert.equal(typeof processed.id, 'string');
    assert.equal(typeof processed.resourceId, 'string');
    assert.equal(typeof processed.normalizedText, 'string');
    assert.ok(Array.isArray(processed.chunks));
    assert.equal(typeof processed.sourceType, 'string');
    assert.equal(typeof processed.metadata, 'object');
    assert.equal(typeof processed.createdAt, 'string');
    assert.equal(typeof processed.updatedAt, 'string');
    assert.equal(processed.metadata.adapterId, 'text');
});

test('resourceId correctly connects resource and processed content', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resourceA = makeValidTextResource({ id: 'res-A', title: 'Resource A' });
    const resourceB = makeValidTextResource({ id: 'res-B', title: 'Resource B' });

    await processAndStore(resourceA, { resRepo, processedRepo });
    await processAndStore(resourceB, { resRepo, processedRepo });

    const procA = await getProcessedContent('res-A', processedRepo);
    const procB = await getProcessedContent('res-B', processedRepo);

    assert.equal(procA.resourceId, 'res-A');
    assert.equal(procB.resourceId, 'res-B');
    assert.notEqual(procA.id, procB.id);
});

/* ── 5. Reprocessing on edit ──────────────────────────────────────── */

test('editing a Text Resource reprocesses it and replaces stale processed content', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource();
    await resRepo.createResource(resource);

    // Initial processing
    const initialProcessed = await processAndStore(resource, { resRepo, processedRepo });
    assert.ok(initialProcessed.normalizedText.includes('Light-dependent reactions'));

    // Edit the resource: update content and updatedAt, keep id and createdAt
    const updatedResource = await resRepo.updateResource(resource.id, {
        content: 'Updated content: Calvin cycle and ATP synthesis.',
    });

    assert.equal(updatedResource.id, resource.id);
    assert.equal(updatedResource.createdAt, resource.createdAt);
    assert.notEqual(updatedResource.updatedAt, resource.createdAt);

    // Reprocess
    const reprocessed = await processAndStore(updatedResource, { resRepo, processedRepo });

    assert.equal(reprocessed.resourceId, resource.id);
    assert.equal(reprocessed.normalizedText, 'Updated content: Calvin cycle and ATP synthesis.');

    // Stale content is not returned
    const current = await getProcessedContent(resource.id, processedRepo);
    assert.equal(current.normalizedText, 'Updated content: Calvin cycle and ATP synthesis.');
    assert.ok(!current.normalizedText.includes('Light-dependent'));
});

test('processResourceById correctly retrieves and processes stored resource', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource({ id: 'res-fetch-1' });
    await resRepo.createResource(resource);

    const processed = await processResourceById('res-fetch-1', { resRepo, processedRepo });

    assert.equal(processed.resourceId, 'res-fetch-1');
    assert.ok(processed.chunks.length > 0);
});

/* ── 6. Error handling ────────────────────────────────────────────── */

test('rejects processing when resource has no valid id', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    await assert.rejects(
        () => processAndStore({ title: 'No ID' }, { resRepo, processedRepo }),
        { code: 'PROCESSING_INVALID_RESOURCE' },
    );
});

test('unsupported resource type throws UNSUPPORTED_RESOURCE_TYPE', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const pdfResource = makeValidTextResource({ type: 'pdf', id: 'pdf-res-1' });
    await resRepo.createResource(pdfResource);

    await assert.rejects(
        () => processAndStore(pdfResource, { resRepo, processedRepo }),
        (err) => {
            assert.ok(isProcessingError(err));
            assert.equal(err.code, 'UNSUPPORTED_RESOURCE_TYPE');
            return true;
        },
    );
});

test('processing failure does not delete the original resource and records failure status', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    // A resource with empty text content causes adapter to reject
    const invalidContentResource = makeValidTextResource({
        id: 'res-fail-1',
        content: '   \r\n  ', // whitespace only -> empty normalized text
        status: 'pending',
    });
    await resRepo.createResource(invalidContentResource);

    await assert.rejects(
        () => processAndStore(invalidContentResource, { resRepo, processedRepo }),
    );

    // Original resource was NOT deleted
    const kept = await resRepo.getResource('res-fail-1');
    assert.ok(kept !== null);
    assert.equal(kept.id, 'res-fail-1');
    assert.equal(kept.title, invalidContentResource.title);
    // Status recorded as failed
    assert.equal(kept.status, 'failed');
    assert.ok(kept.metadata.processingError);
});

test('processResourceById throws for non-existent resource', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    await assert.rejects(
        () => processResourceById('non-existent-id', { resRepo, processedRepo }),
        { code: 'RESOURCE_NOT_FOUND' },
    );
});

/* ── 7. Deletion and cleanup ──────────────────────────────────────── */

test('deleteProcessedContent cleans up processed data for a resource', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();
    const resource = makeValidTextResource({ id: 'res-del-1' });

    await processAndStore(resource, { resRepo, processedRepo });
    assert.ok((await getProcessedContent('res-del-1', processedRepo)) !== null);

    const deleted = await deleteProcessedContent('res-del-1', processedRepo);
    assert.equal(deleted, true);

    const afterDelete = await getProcessedContent('res-del-1', processedRepo);
    assert.equal(afterDelete, null);
});

test('isProcessingError identifies ContentProcessingError instances', () => {
    assert.equal(isProcessingError(new ContentProcessingError('test')), true);
    assert.equal(isProcessingError(new Error('general')), false);
    assert.equal(isProcessingError(null), false);
});
