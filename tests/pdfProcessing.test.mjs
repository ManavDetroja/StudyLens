import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfAdapter } from '../js/processing/pdfAdapter.js';
import { extractPdfText } from '../js/processing/pdfExtractor.js';
import { enrichSegmentsWithPages, processResource } from '../js/processing/contentProcessingPipeline.js';
import { processAndStore } from '../js/features/processingIntegration.js';
import { generateLearningOutputs } from '../js/processing/learningOutputGenerator.js';
import { generateFlashcards } from '../js/processing/flashcardGenerator.js';
import { generateQuiz } from '../js/processing/quizGenerator.js';
import { renderResourceContent } from '../js/features/resourceViewer.js';
import { createResourceRecord } from '../js/storage/resourceValidation.js';
import { createTestPdfBytes } from './helpers/testPdfGenerator.mjs';

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
                chunks: content.segments ?? [],
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

function toProcessedRecord(resource, processedResult) {
    return {
        resourceId: resource.id,
        normalizedText: processedResult.text,
        chunks: processedResult.segments.map((s) => ({
            id: `${resource.id}-chunk-${s.index}`,
            index: s.index,
            text: s.text,
            startOffset: s.startOffset,
            endOffset: s.endOffset,
            pageNumber: s.pageNumber,
            pages: s.pages,
        })),
        metadata: processedResult.metadata,
    };
}

test('1. pdfAdapter.canHandle identifies PDF resources and rejects non-PDF types', () => {
    assert.equal(pdfAdapter.canHandle({ type: 'pdf' }), true);
    assert.equal(pdfAdapter.canHandle({ type: 'text' }), false);
    assert.equal(pdfAdapter.canHandle({ type: 'image' }), false);
    assert.equal(pdfAdapter.canHandle({ type: 'audio' }), false);
    assert.equal(pdfAdapter.canHandle(null), false);
    assert.equal(pdfAdapter.canHandle(undefined), false);
    assert.equal(pdfAdapter.canHandle({}), false);
});

test('2. pdfAdapter.extract rejects non-PDF resources', async () => {
    await assert.rejects(
        () => pdfAdapter.extract({ type: 'text', id: 'res-1' }),
        { code: 'UNSUPPORTED_RESOURCE_TYPE' },
    );
});

test('3. pdfAdapter.extract throws FILE_BLOB_MISSING when blob cannot be found', async () => {
    await assert.rejects(
        () => pdfAdapter.extract(
            { type: 'pdf', id: 'missing-res' },
            { getBlob: async () => null },
        ),
        { code: 'FILE_BLOB_MISSING' },
    );
});

test('4. pdfAdapter.extract throws STORAGE_RETRIEVAL_FAILED on storage exception', async () => {
    await assert.rejects(
        () => pdfAdapter.extract(
            { type: 'pdf', id: 'error-res' },
            { getBlob: async () => { throw new Error('DB disk failure'); } },
        ),
        { code: 'STORAGE_RETRIEVAL_FAILED' },
    );
});

test('5. extractPdfText parses single-page PDF binary bytes and returns page text and metadata', async () => {
    const bytes = createTestPdfBytes(['Photosynthesis is the process by which green plants convert sunlight into chemical energy.']);
    const result = await extractPdfText(bytes);

    assert.equal(result.numPages, 1);
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].pageNumber, 1);
    assert.ok(result.pages[0].text.includes('Photosynthesis'));
    assert.equal(result.metadata.pageCount, 1);
});

test('6. extractPdfText preserves page numbers and distinct texts across multiple pages', async () => {
    const page1 = 'Mitochondria generate cellular energy in the form of adenosine triphosphate.';
    const page2 = 'Ribosomes synthesize proteins by translating messenger RNA sequences.';
    const page3 = 'The nucleus houses the genetic material directing cellular reproduction.';

    const bytes = createTestPdfBytes([page1, page2, page3]);
    const result = await extractPdfText(bytes);

    assert.equal(result.numPages, 3);
    assert.equal(result.pages.length, 3);
    assert.equal(result.pages[0].pageNumber, 1);
    assert.ok(result.pages[0].text.includes('Mitochondria'));
    assert.equal(result.pages[1].pageNumber, 2);
    assert.ok(result.pages[1].text.includes('Ribosomes'));
    assert.equal(result.pages[2].pageNumber, 3);
    assert.ok(result.pages[2].text.includes('nucleus'));
});

test('7. extractPdfText throws NO_SELECTABLE_TEXT for PDFs containing zero selectable text', async () => {
    const bytes = createTestPdfBytes(['   ', '\n\t  ']);
    await assert.rejects(
        () => extractPdfText(bytes),
        (err) => {
            assert.equal(err.code, 'NO_SELECTABLE_TEXT');
            return true;
        },
    );
});

test('8. extractPdfText throws INVALID_PDF on corrupted or truncated binary data', async () => {
    const corruptedBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xaa, 0xbb]);
    await assert.rejects(
        () => extractPdfText(corruptedBytes),
        (err) => {
            assert.equal(err.code, 'INVALID_PDF');
            return true;
        },
    );
});

test('9. extractPdfText throws PDF_DATA_MISSING when passed null and INVALID_PDF_DATA for non-binary input', async () => {
    await assert.rejects(
        () => extractPdfText(null),
        { code: 'PDF_DATA_MISSING' },
    );
    await assert.rejects(
        () => extractPdfText('plain string instead of binary'),
        { code: 'INVALID_PDF_DATA' },
    );
});

test('10. pdfAdapter.normalize builds normalized content with pageOffsets and metadata', () => {
    const extracted = {
        numPages: 2,
        pages: [
            { pageNumber: 1, text: 'First page introduction to cell biology.' },
            { pageNumber: 2, text: 'Second page details on mitosis and meiosis.' },
        ],
        metadata: { pageCount: 2 },
    };

    const normalized = pdfAdapter.normalize(extracted, { type: 'pdf' });
    assert.equal(normalized.sourceType, 'pdf');
    assert.ok(normalized.text.includes('First page introduction'));
    assert.ok(normalized.text.includes('Second page details'));
    assert.equal(normalized.metadata.pageCount, 2);
    assert.equal(normalized.metadata.pages.length, 2);
    assert.equal(normalized.metadata.pageOffsets.length, 2);

    const [offset1, offset2] = normalized.metadata.pageOffsets;
    assert.equal(offset1.pageNumber, 1);
    assert.equal(offset1.startOffset, 0);
    assert.equal(offset1.endOffset, extracted.pages[0].text.length);
    assert.equal(offset2.pageNumber, 2);
    assert.ok(offset2.startOffset > offset1.endOffset);
});

test('11. pdfAdapter.normalize throws NO_SELECTABLE_TEXT if all pages normalize to empty', () => {
    const extracted = {
        numPages: 1,
        pages: [{ pageNumber: 1, text: '   \n\r\t  ' }],
    };
    assert.throws(
        () => pdfAdapter.normalize(extracted, { type: 'pdf' }),
        { code: 'NO_SELECTABLE_TEXT' },
    );
});

test('12. enrichSegmentsWithPages assigns pageNumber and pages array accurately', () => {
    const pageOffsets = [
        { pageNumber: 1, startOffset: 0, endOffset: 100 },
        { pageNumber: 2, startOffset: 102, endOffset: 250 },
    ];

    const segments = [
        { index: 0, startOffset: 10, endOffset: 50, text: 'chunk 1' },
        { index: 1, startOffset: 80, endOffset: 150, text: 'spanning chunk' },
        { index: 2, startOffset: 160, endOffset: 200, text: 'chunk 3' },
    ];

    const enriched = enrichSegmentsWithPages(segments, pageOffsets);
    assert.equal(enriched[0].pageNumber, 1);
    assert.deepEqual(enriched[0].pages, [1]);

    // Spanning chunk covers page 1 and page 2
    assert.equal(enriched[1].pageNumber, 1);
    assert.deepEqual(enriched[1].pages, [1, 2]);

    assert.equal(enriched[2].pageNumber, 2);
    assert.deepEqual(enriched[2].pages, [2]);
});

test('13. Content processing pipeline executes end-to-end on PDF with page traceability', async () => {
    const p1 = 'Osmosis is the net movement of water molecules across a selectively permeable membrane.';
    const p2 = 'Active transport requires energy in the form of ATP to move molecules against concentration gradients.';
    const pdfBytes = createTestPdfBytes([p1, p2]);

    const resource = createResourceRecord({
        type: 'pdf',
        title: 'Cellular Transport Mechanisms',
        status: 'pending',
    });

    const result = await processResource(resource, {
        blob: pdfBytes,
        chunking: { maxChunkSize: 60, overlapSize: 10 },
    });

    assert.equal(result.sourceType, 'pdf');
    assert.equal(result.metadata.adapterId, 'pdf');
    assert.equal(result.metadata.pageCount, 2);
    assert.ok(result.segments.length > 0);
    assert.ok(result.segments[0].pageNumber >= 1);
    assert.ok(Array.isArray(result.segments[0].pages));
});

test('14. Downstream Learning Outputs Engine generates summary from extracted PDF text', async () => {
    const text = 'Osmosis is the net movement of water molecules across a semipermeable membrane. ' +
        'Active transport moves molecules against a concentration gradient using ATP energy. ' +
        'Passive transport occurs without requiring metabolic energy.';
    const pdfBytes = createTestPdfBytes([text]);

    const resource = createResourceRecord({
        type: 'pdf',
        title: 'Cell Transport',
        status: 'pending',
    });

    const processed = await processResource(resource, { blob: pdfBytes });
    const processedRecord = toProcessedRecord(resource, processed);
    const outputs = generateLearningOutputs(processedRecord);

    const summary = outputs.find((o) => o.type === 'summary');
    assert.ok(summary, 'Should generate a summary output');
    assert.ok(summary.content.length > 0);
    assert.equal(summary.resourceId, resource.id);
    assert.ok(Array.isArray(summary.sourceChunkIds));
});

test('15. Downstream Learning Outputs Engine generates key concepts, definitions, and questions from PDF text', async () => {
    const p1 = 'Mitochondria is defined as the membrane-bound organelle that produces cellular ATP.\n\n' +
        'Chloroplast is defined as the plant organelle where photosynthesis takes place.\n\n' +
        'Ribosome refers to the molecular machine that synthesizes cellular proteins.';
    const pdfBytes = createTestPdfBytes([p1]);

    const resource = createResourceRecord({
        type: 'pdf',
        title: 'Organelles',
        status: 'pending',
    });

    const processed = await processResource(resource, { blob: pdfBytes });
    const processedRecord = toProcessedRecord(resource, processed);
    const outputs = generateLearningOutputs(processedRecord);

    const concepts = outputs.filter((o) => o.type === 'concept');
    const definitions = outputs.filter((o) => o.type === 'definition');
    const questions = outputs.filter((o) => o.type === 'question');

    assert.ok(concepts.length > 0, 'Should generate concepts');
    assert.ok(definitions.length > 0, 'Should generate definitions');
    assert.ok(questions.length > 0, 'Should generate questions');

    definitions.forEach((def) => {
        assert.ok(def.metadata.term);
        assert.ok(def.metadata.definition);
        assert.equal(def.resourceId, resource.id);
    });
});

test('16. Flashcard generator produces flashcards from PDF learning outputs', async () => {
    const p1 = 'Enzyme is defined as the biological catalyst that speeds up chemical reactions.\n\n' +
        'Substrate refers to the target molecule upon which an active enzyme acts.\n\n' +
        'Catalyst is defined as a substance that increases the rate of a chemical transformation.';
    const pdfBytes = createTestPdfBytes([p1]);

    const resource = createResourceRecord({
        type: 'pdf',
        title: 'Enzymes',
        status: 'pending',
    });

    const processed = await processResource(resource, { blob: pdfBytes });
    const processedRecord = toProcessedRecord(resource, processed);
    const outputs = generateLearningOutputs(processedRecord);
    const flashcards = generateFlashcards(outputs, resource.id);

    assert.ok(flashcards.length > 0);
    flashcards.forEach((card) => {
        assert.equal(card.type, 'flashcard');
        assert.equal(card.resourceId, resource.id);
        assert.ok(card.content.front);
        assert.ok(card.content.back);
    });
});

test('17. Quiz generator produces MCQs with distractors from PDF definitions', async () => {
    const text = 'Mitosis is defined as the division of genetic material into two identical daughter nuclei.\n\n' +
        'Meiosis is defined as the reduction division producing four genetically distinct gamete cells.\n\n' +
        'Cytokinesis refers to the cytoplasmic division of a cell at the end of mitosis or meiosis.\n\n' +
        'Interphase is defined as the preparatory period of cell growth and DNA replication before division.';
    const pdfBytes = createTestPdfBytes([text]);

    const resource = createResourceRecord({
        type: 'pdf',
        title: 'Cell Division',
        status: 'pending',
    });

    const processed = await processResource(resource, { blob: pdfBytes });
    const processedRecord = toProcessedRecord(resource, processed);
    const outputs = generateLearningOutputs(processedRecord);
    const quiz = generateQuiz(outputs, resource);

    assert.ok(quiz);
    assert.equal(quiz.resourceId, resource.id);
    assert.ok(quiz.questions.length >= 2);
    quiz.questions.forEach((q) => {
        assert.ok(q.question);
        assert.equal(q.options.length, 4);
        assert.ok(q.options.includes(q.correctAnswer));
    });
});

test('18. processAndStore transitions status to completed and sets extracted text on resource', async () => {
    const p1 = 'Newton first law states that an object remains at rest unless acted on by net external force.';
    const pdfBytes = createTestPdfBytes([p1]);

    const resource = createResourceRecord(
        {
            type: 'pdf',
            title: 'Physics Laws',
            status: 'pending',
        },
        { idGenerator: () => 'pdf-store-test-1' },
    );

    const resRepo = createMockResourceRepository([resource]);
    const processedRepo = createMockProcessedRepo();

    const saved = await processAndStore(resource, {
        resRepo,
        processedRepo,
        blob: pdfBytes,
    });

    assert.ok(saved);
    assert.equal(saved.resourceId, resource.id);
    assert.equal(saved.sourceType, 'pdf');

    const updatedResource = await resRepo.getResource(resource.id);
    assert.equal(updatedResource.status, 'completed');
    assert.ok(updatedResource.content.includes('Newton first law'));
});

test('19. Reprocessing a PDF replaces stored content without duplicate accumulation', async () => {
    const p1 = 'Original text on genetics and inheritance.';
    const pdfBytes1 = createTestPdfBytes([p1]);

    const resource = createResourceRecord(
        {
            type: 'pdf',
            title: 'Genetics',
            status: 'pending',
        },
        { idGenerator: () => 'pdf-reprocess-test' },
    );

    const resRepo = createMockResourceRepository([resource]);
    const processedRepo = createMockProcessedRepo();

    // First processing
    await processAndStore(resource, { resRepo, processedRepo, blob: pdfBytes1 });
    const firstProcessed = await processedRepo.getByResourceId(resource.id);

    // Second processing (reprocess with updated text)
    const p2 = 'Updated comprehensive text on genetics, DNA structure, and Mendelian inheritance.';
    const pdfBytes2 = createTestPdfBytes([p2]);

    await processAndStore(resource, { resRepo, processedRepo, blob: pdfBytes2 });
    const secondProcessed = await processedRepo.getByResourceId(resource.id);

    assert.notEqual(firstProcessed.normalizedText, secondProcessed.normalizedText);
    assert.ok(secondProcessed.normalizedText.includes('Updated comprehensive text'));
    assert.ok(secondProcessed.chunks.length > 0);
});

test('20. Processing failure on corrupted PDF sets resource status to failed with error metadata', async () => {
    const resource = createResourceRecord(
        {
            type: 'pdf',
            title: 'Corrupted Doc',
            status: 'pending',
        },
        { idGenerator: () => 'corrupt-pdf-test' },
    );

    const resRepo = createMockResourceRepository([resource]);
    const processedRepo = createMockProcessedRepo();
    const badBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    await assert.rejects(
        () => processAndStore(resource, { resRepo, processedRepo, blob: badBytes }),
    );

    const failedResource = await resRepo.getResource(resource.id);
    assert.equal(failedResource.status, 'failed');
    assert.ok(failedResource.metadata.processingError);
    assert.equal(failedResource.metadata.processingErrorCode, 'INVALID_PDF');
});

test('21. renderResourceContent renders multi-page PDF with page separators', () => {
    const element = { textContent: '' };
    const processed = {
        metadata: {
            pages: [
                { pageNumber: 1, text: 'Content of page one.' },
                { pageNumber: 2, text: 'Content of page two.' },
            ],
        },
    };

    renderResourceContent(element, 'fallback content', 'pdf', processed);
    assert.ok(element.textContent.includes('--- Page 1 ---'));
    assert.ok(element.textContent.includes('Content of page one.'));
    assert.ok(element.textContent.includes('--- Page 2 ---'));
    assert.ok(element.textContent.includes('Content of page two.'));
});

test('22. renderResourceContent shows friendly placeholder when PDF has no content yet', () => {
    const element = { textContent: '' };
    renderResourceContent(element, null, 'pdf', null);
    assert.ok(element.textContent.includes('Click "Extract PDF content" below'));
});
