import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SourceAdapterRegistry,
    sourceAdapterRegistry,
    assertAdapterContract,
} from '../js/processing/sourceAdapterRegistry.js';
import { textAdapter } from '../js/processing/textAdapter.js';
import { pdfAdapter } from '../js/processing/pdfAdapter.js';
import { imageAdapter } from '../js/processing/imageAdapter.js';
import { videoAdapter } from '../js/processing/videoAdapter.js';
import {
    ContentProcessingPipeline,
    processResource,
} from '../js/processing/contentProcessingPipeline.js';
import {
    processAndStore,
    processResourceById,
    isResourceProcessing,
    getActiveProcessingIds,
    classifyProcessingError,
    PROCESSING_ERROR_CODES,
    getProcessedContent,
    deleteProcessedContent,
    isProcessingError,
} from '../js/features/processingIntegration.js';
import { generateLearningOutputs } from '../js/processing/learningOutputGenerator.js';
import { generateFlashcards } from '../js/processing/flashcardGenerator.js';
import { generateQuiz } from '../js/processing/quizGenerator.js';
import { createResourceRecord } from '../js/storage/resourceValidation.js';

function createMockResourceRepository(initial = []) {
    const store = new Map(initial.map((r) => [r.id, { ...r }]));
    return {
        async getResource(id) {
            return store.get(id) ? { ...store.get(id) } : null;
        },
        async updateResource(id, updates) {
            const current = store.get(id);
            if (!current) throw new Error('Resource not found: ' + id);
            const updated = {
                ...current,
                ...updates,
                metadata: { ...(current.metadata || {}), ...(updates.metadata || {}) },
                updatedAt: new Date().toISOString(),
            };
            store.set(id, updated);
            return { ...updated };
        },
        async createResource(res) {
            store.set(res.id, { ...res });
            return { ...res };
        },
        async deleteResource(id) {
            return store.delete(id);
        },
    };
}

function createMockProcessedRepo() {
    const store = new Map();
    return {
        async saveProcessedContent(content) {
            const record = {
                id: content.id || 'proc-' + content.resourceId,
                resourceId: content.resourceId,
                normalizedText: content.text ?? '',
                chunks: (content.segments ?? []).map((s) => ({
                    id: `${content.resourceId}-chunk-${s.index}`,
                    index: s.index,
                    text: s.text,
                    startOffset: s.startOffset,
                    endOffset: s.endOffset,
                    pageNumber: s.pageNumber,
                    pages: s.pages,
                })),
                sourceType: content.sourceType ?? 'text',
                metadata: content.metadata ?? {},
                updatedAt: new Date().toISOString(),
            };
            store.set(content.resourceId, record);
            return record;
        },
        async getByResourceId(id) {
            const found = store.get(id);
            return found ? JSON.parse(JSON.stringify(found)) : null;
        },
        async deleteByResourceId(id) {
            return store.delete(id);
        },
    };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Source Adapter Registry Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('1. Registry asserts adapter contract and rejects invalid objects', () => {
    assert.throws(() => assertAdapterContract(null), { code: 'INVALID_ADAPTER' });
    assert.throws(() => assertAdapterContract({}), { code: 'INVALID_ADAPTER' });
    assert.throws(() => assertAdapterContract({ id: 'test' }), { code: 'INVALID_ADAPTER' });
    assert.throws(
        () => assertAdapterContract({ id: 'test', canHandle: () => true, extract: () => {} }),
        { code: 'INVALID_ADAPTER' }
    );
});

test('2. Registry registers, retrieves, and checks adapters', () => {
    const registry = new SourceAdapterRegistry();
    assert.equal(registry.getAllAdapters().length, 0);

    registry.registerAdapter(textAdapter);
    assert.equal(registry.hasAdapter('text'), true);
    assert.equal(registry.getAdapter('text'), textAdapter);
    assert.equal(registry.getAllAdapters().length, 1);

    registry.registerAdapter(pdfAdapter);
    registry.registerAdapter(imageAdapter);
    assert.equal(registry.getAllAdapters().length, 3);
    assert.equal(registry.hasAdapter('pdf'), true);
    assert.equal(registry.hasAdapter('image'), true);
});

test('3. Registry unregister and clear operations work correctly', () => {
    const registry = new SourceAdapterRegistry([textAdapter, pdfAdapter]);
    assert.equal(registry.getAllAdapters().length, 2);

    const removed = registry.unregisterAdapter('text');
    assert.equal(removed, true);
    assert.equal(registry.hasAdapter('text'), false);
    assert.equal(registry.getAdapter('text'), null);

    registry.clear();
    assert.equal(registry.getAllAdapters().length, 0);

    registry.resetDefaultAdapters();
    assert.equal(registry.getAllAdapters().length, 4);
    assert.ok(registry.hasAdapter('text'));
    assert.ok(registry.hasAdapter('pdf'));
    assert.ok(registry.hasAdapter('image'));
    assert.ok(registry.hasAdapter('video'));
});

test('4. Registry findAdapter finds appropriate adapter and returns null for unknown', () => {
    assert.equal(sourceAdapterRegistry.findAdapter({ type: 'text' }), textAdapter);
    assert.equal(sourceAdapterRegistry.findAdapter({ type: 'pdf' }), pdfAdapter);
    assert.equal(sourceAdapterRegistry.findAdapter({ type: 'image' }), imageAdapter);
    assert.equal(sourceAdapterRegistry.findAdapter({ type: 'video' }), videoAdapter);
    assert.equal(sourceAdapterRegistry.findAdapter({ type: 'audio' }), null);
    assert.equal(sourceAdapterRegistry.findAdapter(null), null);
    assert.equal(sourceAdapterRegistry.findAdapter({}), null);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. Image Adapter Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('5. imageAdapter.canHandle identifies image resources and rejects non-image', () => {
    assert.equal(imageAdapter.canHandle({ type: 'image' }), true);
    assert.equal(imageAdapter.canHandle({ type: 'text' }), false);
    assert.equal(imageAdapter.canHandle({ type: 'pdf' }), false);
    assert.equal(imageAdapter.canHandle({ type: 'video' }), false);
    assert.equal(imageAdapter.canHandle(null), false);
    assert.equal(imageAdapter.canHandle({}), false);
});

test('6. imageAdapter.extract rejects non-image resources', async () => {
    await assert.rejects(
        () => imageAdapter.extract({ type: 'text', id: 'img-1' }),
        { code: 'UNSUPPORTED_RESOURCE_TYPE' }
    );
});

test('7. imageAdapter.extract retrieves text from resource.content', async () => {
    const resource = {
        id: 'img-res-1',
        type: 'image',
        title: 'Cell diagram notes',
        content: 'Mitochondria is the powerhouse of the cell. Chloroplast conducts photosynthesis.',
        metadata: { originalFileName: 'cell.png', mimeType: 'image/png' },
    };

    const extracted = await imageAdapter.extract(resource);
    assert.equal(extracted.text, resource.content);
    assert.equal(extracted.metadata.originalFileName, 'cell.png');
    assert.equal(extracted.metadata.mimeType, 'image/png');
});

test('8. imageAdapter.extract retrieves text from metadata or options', async () => {
    const resource = {
        id: 'img-res-2',
        type: 'image',
        title: 'Whiteboard notes',
        content: null,
        metadata: { extractedText: 'Newton second law is F equals ma.' },
    };

    const extracted = await imageAdapter.extract(resource);
    assert.equal(extracted.text, 'Newton second law is F equals ma.');

    const fromOptions = await imageAdapter.extract(
        { id: 'img-res-3', type: 'image', title: 'Test' },
        { text: 'Direct option text.' }
    );
    assert.equal(fromOptions.text, 'Direct option text.');
});

test('9. imageAdapter.extract invokes pluggable ocrExtractor with blob', async () => {
    const fakeBlob = { size: 1024, type: 'image/jpeg' };
    const resource = {
        id: 'img-ocr-1',
        type: 'image',
        title: 'Document photo',
        content: null,
        blob: fakeBlob,
    };

    const mockOcr = async (blob) => {
        assert.equal(blob, fakeBlob);
        return 'Optical character recognition result: DNA is deoxyribonucleic acid.';
    };

    const extracted = await imageAdapter.extract(resource, { ocrExtractor: mockOcr });
    assert.ok(extracted.text.includes('DNA is deoxyribonucleic acid.'));
});

test('10. imageAdapter.extract throws FILE_BLOB_MISSING when neither text nor blob exists', async () => {
    const resource = {
        id: 'img-empty-1',
        type: 'image',
        title: 'Missing image',
        content: null,
        metadata: {},
    };

    await assert.rejects(
        () => imageAdapter.extract(resource, { getBlob: async () => null }),
        { code: 'FILE_BLOB_MISSING' }
    );
});

test('11. imageAdapter.extract throws NO_EXTRACTED_TEXT when blob has no readable text', async () => {
    const resource = {
        id: 'img-noblobtext-1',
        type: 'image',
        title: 'Blank image',
        content: null,
        blob: { size: 500, type: 'image/png' },
    };

    await assert.rejects(
        () => imageAdapter.extract(resource),
        { code: 'NO_EXTRACTED_TEXT' }
    );
});

test('12. imageAdapter.normalize normalizes text deterministically', () => {
    const resource = { id: 'img-norm-1', type: 'image', updatedAt: '2026-09-27T10:00:00.000Z' };
    const extracted = {
        text: '  First image line.\r\n\r\nSecond image line.  ',
        metadata: { format: 'png' },
    };

    const normalized = imageAdapter.normalize(extracted, resource);
    assert.equal(normalized.resourceId, 'img-norm-1');
    assert.equal(normalized.sourceType, 'image');
    assert.equal(normalized.text, 'First image line.\n\nSecond image line.');
    assert.equal(normalized.metadata.adapterId, 'image');
    assert.equal(normalized.metadata.format, 'png');
});

test('13. imageAdapter.normalize throws RESOURCE_CONTENT_MISSING on empty text', () => {
    const resource = { id: 'img-empty-norm', type: 'image' };
    assert.throws(
        () => imageAdapter.normalize({ text: '   \n  ' }, resource),
        { code: 'RESOURCE_CONTENT_MISSING' }
    );
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. Unified Content Processing Pipeline Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('14. Unified pipeline processes Text, PDF, and Image through common interface', async () => {
    // 14a. Text Resource
    const textRes = {
        id: 'res-unified-text',
        title: 'Text Resource',
        type: 'text',
        source: 'manual://text-entry',
        content: 'Polymorphism is an object-oriented programming principle.\n\nIt allows methods to take multiple forms.',
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'completed',
        tags: ['java'],
        metadata: {},
    };
    const textResult = await processResource(textRes);
    assert.equal(textResult.sourceType, 'text');
    assert.ok(textResult.segments.length > 0);

    // 14b. Image Resource with text
    const imageRes = {
        id: 'res-unified-image',
        title: 'Image Resource',
        type: 'image',
        source: 'local://file-import',
        content: 'Encapsulation is bundling data and methods that operate on that data.\n\nIt prevents direct external access.',
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'pending',
        tags: ['oop'],
        metadata: { originalFileName: 'oop_diagram.png' },
    };
    const imageResult = await processResource(imageRes);
    assert.equal(imageResult.sourceType, 'image');
    assert.ok(imageResult.segments.length > 0);
    assert.equal(imageResult.metadata.adapterId, 'image');
});

test('15. Unified pipeline cleanly rejects unsupported resource types', async () => {
    const pipelineWithoutVideo = new ContentProcessingPipeline({ adapters: [textAdapter, pdfAdapter, imageAdapter] });
    const unsupportedRes = {
        id: 'res-video',
        title: 'Video lecture',
        type: 'video',
        source: 'https://example.com/lecture',
        content: null,
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'pending',
        tags: [],
        metadata: {},
    };

    await assert.rejects(
        () => pipelineWithoutVideo.processResource(unsupportedRes),
        { code: 'UNSUPPORTED_RESOURCE_TYPE' }
    );
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. Concurrency Locking & Lifecycle Orchestration Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('16. Concurrency lock prevents duplicate simultaneous processing for the same resource', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedRepo();

    const resource = {
        id: 'res-lock-test',
        title: 'Locking Test Resource',
        type: 'text',
        source: 'manual://text-entry',
        content: 'Cellular respiration converts glucose into ATP.\r\n\r\nIt takes place in the mitochondria.',
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'completed',
        tags: ['biology'],
        metadata: {},
    };
    await resRepo.createResource(resource);

    // Initial check: not processing
    assert.equal(isResourceProcessing('res-lock-test'), false);

    // Trigger processing and attempt second concurrent call immediately
    const firstPromise = processAndStore(resource, { resRepo, processedRepo });

    // Second call while first is in-flight must be rejected by lock
    await assert.rejects(
        () => processAndStore(resource, { resRepo, processedRepo }),
        (err) => {
            assert.ok(isProcessingError(err));
            assert.equal(err.code, 'PROCESSING_ALREADY_IN_PROGRESS');
            return true;
        }
    );

    const firstResult = await firstPromise;
    assert.ok(firstResult.id);

    // Lock must be released after completion
    assert.equal(isResourceProcessing('res-lock-test'), false);
});

test('17. Concurrency lock is cleanly released even when processing fails', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedRepo();

    const badImage = {
        id: 'res-fail-lock',
        title: 'Bad Image Resource',
        type: 'image',
        source: 'local://file-import',
        content: null,
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'pending',
        tags: [],
        metadata: {},
    };
    await resRepo.createResource(badImage);

    // Processing fails due to missing blob and missing text
    await assert.rejects(
        () => processAndStore(badImage, { resRepo, processedRepo, getBlob: async () => null }),
        { code: 'FILE_BLOB_MISSING' }
    );

    // Lock must be released
    assert.equal(isResourceProcessing('res-fail-lock'), false);

    // Failed resource has status 'failed' and metadata recorded
    const stored = await resRepo.getResource('res-fail-lock');
    assert.equal(stored.status, 'failed');
    assert.equal(stored.metadata.processingErrorCode, 'FILE_BLOB_MISSING');
});

test('18. Error classification maps known and unknown errors to standard categories', () => {
    assert.equal(
        classifyProcessingError({ code: 'UNSUPPORTED_RESOURCE_TYPE' }),
        PROCESSING_ERROR_CODES.UNSUPPORTED_SOURCE
    );
    assert.equal(
        classifyProcessingError({ code: 'RESOURCE_CONTENT_MISSING' }),
        PROCESSING_ERROR_CODES.MISSING_SOURCE
    );
    assert.equal(
        classifyProcessingError({ code: 'FILE_BLOB_MISSING' }),
        PROCESSING_ERROR_CODES.MISSING_BLOB
    );
    assert.equal(
        classifyProcessingError({ code: 'PROCESSING_ALREADY_IN_PROGRESS' }),
        PROCESSING_ERROR_CODES.PROCESSING_ALREADY_IN_PROGRESS
    );
    assert.equal(
        classifyProcessingError({ code: 'NO_SELECTABLE_TEXT' }),
        PROCESSING_ERROR_CODES.EXTRACTION_FAILED
    );
    assert.equal(
        classifyProcessingError({ code: 'INVALID_NORMALIZED_CONTENT' }),
        PROCESSING_ERROR_CODES.NORMALIZATION_FAILED
    );
    assert.equal(
        classifyProcessingError({ code: 'CHUNKING_FAILED' }),
        PROCESSING_ERROR_CODES.CHUNKING_FAILED
    );
    assert.equal(
        classifyProcessingError({ code: 'STORAGE_ERROR' }),
        PROCESSING_ERROR_CODES.PERSISTENCE_FAILED
    );
    assert.equal(
        classifyProcessingError({ code: 'CUSTOM_ERR' }),
        'CUSTOM_ERR'
    );
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. Idempotency & Chunk Deduplication Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('19. Reprocessing is idempotent and replaces stale chunks without accumulating duplicates', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedRepo();

    const resource = {
        id: 'res-idempotent-1',
        title: 'Initial Title',
        type: 'text',
        source: 'manual://text-entry',
        content: 'Original paragraph one.\n\nOriginal paragraph two.',
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'completed',
        tags: [],
        metadata: {},
    };
    await resRepo.createResource(resource);

    // First process with maxChunkSize: 30 to force 2 chunks
    const run1 = await processAndStore(resource, { resRepo, processedRepo, chunking: { maxChunkSize: 30 } });
    assert.equal(run1.chunks.length, 2);

    // Second process with updated single short paragraph (fits in 1 chunk)
    const updated = {
        ...resource,
        content: 'Short replacement.',
        updatedAt: '2026-09-27T00:05:00.000Z',
    };
    await resRepo.updateResource(resource.id, updated);

    const run2 = await processAndStore(updated, { resRepo, processedRepo, chunking: { maxChunkSize: 30 } });
    assert.equal(run2.chunks.length, 1);
    assert.equal(run2.normalizedText, 'Short replacement.');

    // Fetch from repository directly
    const stored = await processedRepo.getByResourceId(resource.id);
    assert.equal(stored.chunks.length, 1);
    assert.equal(stored.normalizedText, 'Short replacement.');
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. Downstream Feature Parity Across All Modalities
 * ═══════════════════════════════════════════════════════════════════════════ */

test('20. Processed image resource achieves full downstream feature parity (Outputs, Cards, Quizzes)', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedRepo();

    const biologyImage = {
        id: 'res-parity-image',
        title: 'Cell Biology Notes',
        type: 'image',
        source: 'local://file-import',
        content: 'Photosynthesis is the biological process of converting light energy into chemical energy. Chloroplast is the organelle where photosynthesis takes place. Mitochondria is responsible for generating cellular ATP.',
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
        status: 'pending',
        tags: ['biology'],
        metadata: { originalFileName: 'bio_board.jpg', mimeType: 'image/jpeg' },
    };
    await resRepo.createResource(biologyImage);

    // 1. Unified Processing
    const processed = await processAndStore(biologyImage, { resRepo, processedRepo });
    assert.equal(processed.resourceId, biologyImage.id);
    assert.ok(processed.chunks.length > 0);

    // 2. Day 10 Learning Outputs Generation
    const outputs = generateLearningOutputs(processed);
    assert.ok(outputs.length > 0);

    const summary = outputs.find((o) => o.type === 'summary');
    const concepts = outputs.filter((o) => o.type === 'concept');
    const definitions = outputs.filter((o) => o.type === 'definition');
    const questions = outputs.filter((o) => o.type === 'question');

    assert.ok(summary);
    assert.ok(concepts.length > 0);
    assert.ok(definitions.length > 0);
    assert.ok(questions.length > 0);

    // Traceability preserved: all outputs point to valid source chunk IDs
    outputs.forEach((output) => {
        assert.ok(Array.isArray(output.sourceChunkIds));
        assert.ok(output.sourceChunkIds.length > 0);
        output.sourceChunkIds.forEach((chunkId) => {
            assert.ok(processed.chunks.some((c) => c.id === chunkId || c.index === chunkId));
        });
    });

    // 3. Day 12 Flashcards Generation
    const flashcards = generateFlashcards(outputs, biologyImage.id);
    assert.ok(flashcards.length > 0);
    flashcards.forEach((card) => {
        assert.ok(typeof card.content.front === 'string' && card.content.front.length > 0);
        assert.ok(typeof card.content.back === 'string' && card.content.back.length > 0);
        assert.ok(Array.isArray(card.sourceChunkIds) && card.sourceChunkIds.length > 0);
    });

    // 4. Day 13–14 Quiz Generation
    const quiz = generateQuiz(outputs, biologyImage);
    assert.ok(quiz);
    assert.ok(quiz.questions.length >= 2);
    quiz.questions.forEach((q) => {
        assert.ok(q.question.length > 0);
        assert.ok(Array.isArray(q.options) && q.options.length >= 2);
        assert.ok(q.options.includes(q.correctAnswer));
        assert.ok(Array.isArray(q.sourceChunkIds) && q.sourceChunkIds.length > 0);
    });
});
