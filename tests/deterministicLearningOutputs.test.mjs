import test from 'node:test';
import assert from 'node:assert/strict';
import {
    splitSentences,
    findOverlappingChunkIds,
    extractKeyConcepts,
    extractDefinitions,
    generateQuestions,
    generateExtractiveSummary,
    analyzeContent,
} from '../js/processing/contentAnalysis.js';
import {
    generateLearningOutputs,
    DAY10_OUTPUT_TYPES,
} from '../js/processing/learningOutputGenerator.js';
import {
    generateLearningOutputsForResource,
    getLearningOutputsSummaryForResource,
    clearLearningOutputsForResource,
} from '../js/features/learningOutputService.js';
import { validateLearningOutput } from '../js/storage/learningOutputValidation.js';

/* ── Sample educational text fixture ─────────────────────────────── */

const SAMPLE_TEXT = `Photosynthesis is the process by which green plants and certain other organisms transform light energy into chemical energy. During photosynthesis in green plants, light energy is captured and used to convert water, carbon dioxide, and minerals into oxygen and energy-rich organic compounds.

Chloroplasts are defined as the specialized cellular organelles where photosynthesis takes place. Within the chloroplasts, chlorophyll absorbs solar radiation. The thylakoid membrane is responsible for the light-dependent reactions of photosynthesis.

ATP refers to adenosine triphosphate, which provides energy to drive many processes in living cells. In the stroma of the chloroplast, carbon fixation occurs to produce sugars.`;

function createSampleProcessedContent(overrides = {}) {
    // Two chunks splitting across the paragraphs
    const chunk1Text = `Photosynthesis is the process by which green plants and certain other organisms transform light energy into chemical energy. During photosynthesis in green plants, light energy is captured and used to convert water, carbon dioxide, and minerals into oxygen and energy-rich organic compounds.\n\n`;
    const chunk2Text = `Chloroplasts are defined as the specialized cellular organelles where photosynthesis takes place. Within the chloroplasts, chlorophyll absorbs solar radiation. The thylakoid membrane is responsible for the light-dependent reactions of photosynthesis.\n\nATP refers to adenosine triphosphate, which provides energy to drive many processes in living cells. In the stroma of the chloroplast, carbon fixation occurs to produce sugars.`;

    const fullText = chunk1Text + chunk2Text;

    const chunks = [
        {
            index: 0,
            startOffset: 0,
            endOffset: chunk1Text.length,
            text: chunk1Text,
        },
        {
            index: 1,
            startOffset: chunk1Text.length,
            endOffset: fullText.length,
            text: chunk2Text,
        },
    ];

    return {
        id: 'proc-test-1',
        resourceId: 'res-bio-101',
        normalizedText: fullText,
        chunks,
        sourceType: 'text',
        metadata: {},
        createdAt: '2026-09-23T10:00:00.000Z',
        updatedAt: '2026-09-23T10:00:00.000Z',
        ...overrides,
    };
}

/** In-memory mock repositories for testing service and regeneration */
function createMockRepositories() {
    const resources = new Map();
    const processed = new Map();
    const learningOutputs = new Map(); // id -> output

    const resRepo = {
        async getResource(id) {
            return resources.get(id) ? { ...resources.get(id) } : null;
        },
        async createResource(r) {
            resources.set(r.id, { ...r });
            return { ...r };
        },
        async updateResource(id, u) {
            const existing = resources.get(id);
            if (!existing) throw new Error('Not found');
            const updated = { ...existing, ...u };
            resources.set(id, updated);
            return { ...updated };
        },
    };

    const processedRepo = {
        async getByResourceId(resId) {
            return processed.get(resId) ? { ...processed.get(resId) } : null;
        },
        async saveProcessedContent(pc) {
            processed.set(pc.resourceId, { ...pc });
            return { ...pc };
        },
    };

    const learningRepo = {
        async createLearningOutput(output) {
            validateLearningOutput(output);
            learningOutputs.set(output.id, { ...output });
            return { ...output };
        },
        async getLearningOutput(id) {
            return learningOutputs.get(id) ? { ...learningOutputs.get(id) } : null;
        },
        async getLearningOutputsByResourceId(resId) {
            return [...learningOutputs.values()].filter((o) => o.resourceId === resId);
        },
        async deleteLearningOutputsByResourceId(resId) {
            let count = 0;
            for (const [id, o] of learningOutputs.entries()) {
                if (o.resourceId === resId) {
                    learningOutputs.delete(id);
                    count++;
                }
            }
            return count;
        },
        getAll() {
            return [...learningOutputs.values()];
        },
    };

    return { resRepo, processedRepo, learningRepo, resources, processed, learningOutputs };
}

/* ── 1. Content Analysis Tests ───────────────────────────────────── */

test('splitSentences extracts non-empty sentences with correct offsets', () => {
    const text = 'First sentence. Second sentence! Third sentence?';
    const sentences = splitSentences(text);

    assert.equal(sentences.length, 3);
    assert.equal(sentences[0].text, 'First sentence.');
    assert.equal(sentences[1].text, 'Second sentence!');
    assert.equal(sentences[2].text, 'Third sentence?');

    assert.equal(sentences[0].startOffset, 0);
    assert.equal(sentences[0].endOffset, 15);
    assert.equal(text.slice(sentences[0].startOffset, sentences[0].endOffset), 'First sentence.');
});

test('findOverlappingChunkIds correctly identifies containing chunk indices', () => {
    const chunks = [
        { index: 0, startOffset: 0, endOffset: 50 },
        { index: 1, startOffset: 50, endOffset: 100 },
        { index: 2, startOffset: 100, endOffset: 150 },
    ];

    assert.deepEqual(findOverlappingChunkIds(10, 30, chunks), [0]);
    assert.deepEqual(findOverlappingChunkIds(55, 80, chunks), [1]);
    assert.deepEqual(findOverlappingChunkIds(40, 60, chunks), [0, 1]);
});

test('extractKeyConcepts extracts meaningful non-stopword terms and phrases with scores and chunks', () => {
    const processed = createSampleProcessedContent();
    const concepts = extractKeyConcepts(processed.normalizedText, processed.chunks);

    assert.ok(concepts.length > 0);
    const terms = concepts.map((c) => c.term.toLowerCase());

    assert.ok(terms.includes('photosynthesis'));
    assert.ok(terms.includes('chloroplasts') || terms.includes('chloroplast'));

    // Verify each concept has valid score and sourceChunkIds
    concepts.forEach((concept) => {
        assert.ok(typeof concept.term === 'string');
        assert.ok(concept.score > 0);
        assert.ok(Array.isArray(concept.sourceChunkIds));
        assert.ok(concept.sourceChunkIds.length > 0);
    });

    // Check that photosynthesis appears in both chunks
    const photoConcept = concepts.find((c) => c.term.toLowerCase() === 'photosynthesis');
    assert.ok(photoConcept);
    assert.ok(photoConcept.sourceChunkIds.includes(0));
});

test('extractDefinitions recognizes explicit textual definition patterns', () => {
    const sentences = [
        { text: 'Photosynthesis is the process by which plants make food.', startOffset: 0, endOffset: 56 },
        { text: 'Chloroplasts are defined as the cellular organelles for photosynthesis.', startOffset: 60, endOffset: 130 },
        { text: 'ATP refers to adenosine triphosphate.', startOffset: 135, endOffset: 172 },
        { text: 'It is a sunny day outside.', startOffset: 175, endOffset: 201 }, // should be ignored as generic
    ];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 250 }];

    const definitions = extractDefinitions(sentences, chunks);

    assert.equal(definitions.length, 3);
    assert.equal(definitions[0].term, 'Photosynthesis');
    assert.ok(definitions[0].definition.includes('process by which plants'));
    assert.deepEqual(definitions[0].sourceChunkIds, [0]);

    assert.equal(definitions[1].term, 'Chloroplasts');
    assert.ok(definitions[1].definition.includes('cellular organelles'));

    assert.equal(definitions[2].term, 'ATP');
    assert.ok(definitions[2].definition.includes('adenosine triphosphate'));
});

test('generateQuestions produces deterministic questions with source chunk traceability', () => {
    const definitions = [
        { term: 'Photosynthesis', definition: 'the process of creating energy', sourceChunkIds: [0] },
    ];
    const concepts = [
        { term: 'Chlorophyll', score: 10, sourceChunkIds: [1] },
    ];
    const sentences = [
        { text: 'The thylakoid membrane is responsible for light reactions.', startOffset: 0, endOffset: 58 },
    ];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 100 }];

    const questions = generateQuestions(definitions, concepts, sentences, chunks);

    assert.ok(questions.length > 0);
    assert.ok(questions.some((q) => q.question.includes('What is Photosynthesis?')));
    assert.ok(questions.some((q) => q.question.includes('Chlorophyll')));

    questions.forEach((q) => {
        assert.ok(q.question.endsWith('?'));
        assert.ok(Array.isArray(q.sourceChunkIds));
        assert.ok(q.sourceChunkIds.length > 0);
    });
});

test('generateExtractiveSummary creates deterministic sentence selection preserving order', () => {
    const sentences = [
        { text: 'Photosynthesis is an essential biological process.', startOffset: 0, endOffset: 50 },
        { text: 'It happens everywhere.', startOffset: 52, endOffset: 74 },
        { text: 'Chloroplasts absorb solar energy to synthesize glucose molecules.', startOffset: 76, endOffset: 141 },
    ];
    const concepts = [{ term: 'Photosynthesis', score: 10 }, { term: 'Chloroplasts', score: 8 }];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 150 }];

    const summary = generateExtractiveSummary(sentences, concepts, chunks, { maxSentences: 2 });

    assert.ok(summary.text.length > 0);
    assert.ok(summary.text.includes('Photosynthesis is an essential biological process.'));
    assert.ok(summary.sentenceCount <= 2);
    assert.deepEqual(summary.sourceChunkIds, [0]);
});

test('analyzeContent returns comprehensive deterministic analysis', () => {
    const processed = createSampleProcessedContent();

    const analysis1 = analyzeContent(processed);
    const analysis2 = analyzeContent(processed);

    // Determinism check: identical results across runs
    assert.deepEqual(analysis1.concepts, analysis2.concepts);
    assert.deepEqual(analysis1.definitions, analysis2.definitions);
    assert.deepEqual(analysis1.questions, analysis2.questions);
    assert.equal(analysis1.summary.text, analysis2.summary.text);
    assert.deepEqual(analysis1.summary.sourceChunkIds, analysis2.summary.sourceChunkIds);

    // Structural checks
    assert.ok(analysis1.concepts.length > 0);
    assert.ok(analysis1.definitions.length > 0);
    assert.ok(analysis1.questions.length > 0);
    assert.ok(analysis1.summary.text.length > 0);
    assert.equal(typeof analysis1.metadata.totalSentences, 'number');
});

test('analyzeContent handles empty text safely without crashing', () => {
    const emptyResult = analyzeContent({ normalizedText: '', chunks: [] });
    assert.deepEqual(emptyResult.concepts, []);
    assert.deepEqual(emptyResult.definitions, []);
    assert.deepEqual(emptyResult.questions, []);
    assert.equal(emptyResult.summary.text, '');
    assert.equal(emptyResult.metadata.totalSentences, 0);
});

/* ── 2. Learning Output Generator Tests ───────────────────────────── */

test('generateLearningOutputs generates summary, concept, definition, and question records', () => {
    const processed = createSampleProcessedContent();
    const outputs = generateLearningOutputs(processed);

    assert.ok(outputs.length > 0);

    const types = new Set(outputs.map((o) => o.type));
    assert.ok(types.has('summary'), 'Must generate summary output');
    assert.ok(types.has('concept'), 'Must generate concept outputs');
    assert.ok(types.has('definition'), 'Must generate definition outputs');
    assert.ok(types.has('question'), 'Must generate question outputs');

    // Must NOT generate flashcard or quiz yet
    assert.ok(!types.has('flashcard'), 'Flashcard must not be generated in Day 10');
    assert.ok(!types.has('quiz'), 'Quiz must not be generated in Day 10');

    // Validate every generated output record against Day 9 validation
    outputs.forEach((output) => {
        assert.doesNotThrow(() => validateLearningOutput(output));
        assert.equal(output.resourceId, processed.resourceId);
        assert.ok(output.id);
        assert.ok(output.createdAt);
        assert.ok(output.updatedAt);
        assert.ok(Array.isArray(output.sourceChunkIds));
        assert.ok(output.sourceChunkIds.length > 0, `Output ${output.type} must retain sourceChunkIds`);
    });
});

test('generateLearningOutputs strictly enforces Day 10 supported types', () => {
    assert.deepEqual(DAY10_OUTPUT_TYPES, ['summary', 'concept', 'definition', 'question']);
});

/* ── 3. Orchestration Service and Regeneration Tests ──────────────── */

test('generateLearningOutputsForResource orchestrates analysis, persistence, and returns counts', async () => {
    const { resRepo, processedRepo, learningRepo, resources, processed } = createMockRepositories();

    const sampleResource = {
        id: 'res-bio-101',
        title: 'Photosynthesis 101',
        type: 'text',
        content: SAMPLE_TEXT,
        status: 'completed',
    };
    resources.set(sampleResource.id, sampleResource);
    processed.set(sampleResource.id, createSampleProcessedContent());

    const result = await generateLearningOutputsForResource('res-bio-101', {
        resRepo,
        processedRepo,
        learningRepo,
    });

    assert.equal(result.resourceId, 'res-bio-101');
    assert.ok(result.outputs.length > 0);
    assert.equal(result.counts.total, result.outputs.length);
    assert.equal(result.counts.summary, 1);
    assert.ok(result.counts.concept > 0);
    assert.ok(result.counts.definition > 0);
    assert.ok(result.counts.question > 0);

    // Verify stored in repository
    const storedOutputs = await learningRepo.getLearningOutputsByResourceId('res-bio-101');
    assert.equal(storedOutputs.length, result.outputs.length);
});

test('regeneration replaces previous outputs without creating duplicates', async () => {
    const { resRepo, processedRepo, learningRepo, resources, processed } = createMockRepositories();

    const sampleResource = {
        id: 'res-regen-1',
        title: 'Regeneration Test',
        type: 'text',
        content: SAMPLE_TEXT,
    };
    resources.set(sampleResource.id, sampleResource);
    processed.set(sampleResource.id, createSampleProcessedContent({ resourceId: 'res-regen-1' }));

    // First generation run
    const run1 = await generateLearningOutputsForResource('res-regen-1', {
        resRepo,
        processedRepo,
        learningRepo,
    });
    const countAfterRun1 = (await learningRepo.getLearningOutputsByResourceId('res-regen-1')).length;
    assert.equal(countAfterRun1, run1.outputs.length);

    // Second generation run (Regeneration)
    const run2 = await generateLearningOutputsForResource('res-regen-1', {
        resRepo,
        processedRepo,
        learningRepo,
    });
    const countAfterRun2 = (await learningRepo.getLearningOutputsByResourceId('res-regen-1')).length;

    // Must NOT double the count
    assert.equal(countAfterRun2, run2.outputs.length);
    assert.equal(countAfterRun2, countAfterRun1);
});

test('getLearningOutputsSummaryForResource returns grouped counts and status', async () => {
    const { resRepo, processedRepo, learningRepo, resources, processed } = createMockRepositories();

    const sampleResource = { id: 'res-summary-test', title: 'Test', type: 'text', content: SAMPLE_TEXT };
    resources.set(sampleResource.id, sampleResource);
    processed.set(sampleResource.id, createSampleProcessedContent({ resourceId: 'res-summary-test' }));

    await generateLearningOutputsForResource('res-summary-test', { resRepo, processedRepo, learningRepo });

    const summary = await getLearningOutputsSummaryForResource('res-summary-test', { learningRepo });

    assert.equal(summary.hasOutputs, true);
    assert.ok(summary.total > 0);
    assert.equal(summary.counts.summary, 1);
    assert.ok(summary.counts.concept > 0);
    assert.ok(summary.counts.definition > 0);
    assert.ok(summary.counts.question > 0);
});

test('clearLearningOutputsForResource removes all outputs for a resource', async () => {
    const { resRepo, processedRepo, learningRepo, resources, processed } = createMockRepositories();

    const sampleResource = { id: 'res-clear-test', title: 'Test', type: 'text', content: SAMPLE_TEXT };
    resources.set(sampleResource.id, sampleResource);
    processed.set(sampleResource.id, createSampleProcessedContent({ resourceId: 'res-clear-test' }));

    await generateLearningOutputsForResource('res-clear-test', { resRepo, processedRepo, learningRepo });
    assert.ok((await learningRepo.getLearningOutputsByResourceId('res-clear-test')).length > 0);

    const clearedCount = await clearLearningOutputsForResource('res-clear-test', { learningRepo });
    assert.ok(clearedCount > 0);
    assert.equal((await learningRepo.getLearningOutputsByResourceId('res-clear-test')).length, 0);
});

test('service handles missing resource and empty content with clear errors', async () => {
    const { resRepo, processedRepo, learningRepo, resources } = createMockRepositories();

    await assert.rejects(
        () => generateLearningOutputsForResource('non-existent-id', { resRepo, processedRepo, learningRepo }),
        /Resource not found/,
    );

    // Empty content resource
    resources.set('res-empty', { id: 'res-empty', content: '   ' });
    await assert.rejects(
        () => generateLearningOutputsForResource('res-empty', { resRepo, processedRepo, learningRepo }),
        /No processed content is available/,
    );
});
