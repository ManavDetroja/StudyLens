import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatSourceChunks,
    renderSummarySection,
    renderConceptsSection,
    renderDefinitionsSection,
    renderQuestionsSection,
    renderEmptyState,
    renderLoadingState,
    renderErrorState,
    renderLearningOutputs,
} from '../js/features/learningOutputView.js';

import {
    generateLearningOutputsForResource,
    getLearningOutputsSummaryForResource,
} from '../js/features/learningOutputService.js';

/* ── Minimal lightweight mock DOM for Node unit tests ───────────────── */

function createMockElement(tagName = 'div') {
    return {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        title: '',
        dataset: {},
        attributes: {},
        children: [],
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return this.attributes[name] ?? null;
        },
        append(...items) {
            for (const item of items) {
                if (typeof item === 'string') {
                    this.textContent += item;
                } else if (item) {
                    this.children.push(item);
                }
            }
        },
        replaceChildren(...items) {
            this.children = [];
            this.textContent = '';
            this.append(...items);
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] ?? null;
        },
        querySelectorAll(selector) {
            const results = [];
            function traverse(node) {
                for (const child of node.children) {
                    if (matches(child, selector)) results.push(child);
                    traverse(child);
                }
            }
            traverse(this);
            return results;
        },
    };
}

function matches(el, selector) {
    if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return el.className.split(/\s+/).includes(cls);
    }
    if (selector.startsWith('[')) {
        const attr = selector.slice(1, -1);
        if (attr.includes('=')) {
            const [k, v] = attr.split('=');
            const cleanVal = v.replace(/['"]/g, '');
            if (k.startsWith('data-')) {
                const datasetKey = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                return el.dataset[datasetKey] === cleanVal;
            }
            return el.attributes[k] === cleanVal;
        }
        if (attr.startsWith('data-')) {
            const datasetKey = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return el.dataset[datasetKey] !== undefined;
        }
        return el.attributes[attr] !== undefined;
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
}

// Setup globalThis.document mock for Node test runner
const previousDocument = globalThis.document;
globalThis.document = {
    createElement(tag) {
        return createMockElement(tag);
    },
};

/* ── In-memory mock repositories for service integration tests ─────── */

function createMockRepositories() {
    const resourcesMap = new Map();
    const processedMap = new Map();
    const outputsMap = new Map();

    const resRepo = {
        async getResource(id) {
            return resourcesMap.get(id) ?? null;
        },
        async createResource(record) {
            resourcesMap.set(record.id, { ...record });
            return record;
        },
        async updateResource(id, updates) {
            const existing = resourcesMap.get(id);
            if (!existing) return null;
            const updated = { ...existing, ...updates };
            resourcesMap.set(id, updated);
            return updated;
        },
    };

    const processedRepo = {
        async getByResourceId(resId) {
            return processedMap.get(resId) ?? null;
        },
        async saveProcessedContent(normalizedContent) {
            const record = {
                id: 'proc-' + normalizedContent.resourceId,
                resourceId: normalizedContent.resourceId,
                normalizedText: normalizedContent.text,
                chunks: normalizedContent.segments,
                sourceType: normalizedContent.sourceType,
                metadata: normalizedContent.metadata,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            processedMap.set(normalizedContent.resourceId, record);
            return record;
        },
        async deleteByResourceId(resId) {
            const existed = processedMap.has(resId);
            processedMap.delete(resId);
            return existed;
        },
    };

    const learningRepo = {
        async getLearningOutputsByResourceId(resId) {
            const list = [];
            for (const out of outputsMap.values()) {
                if (out.resourceId === resId) list.push({ ...out });
            }
            return list;
        },
        async createLearningOutput(record) {
            outputsMap.set(record.id, { ...record });
            return { ...record };
        },
        async deleteLearningOutputsByResourceId(resId) {
            let count = 0;
            for (const [id, out] of outputsMap.entries()) {
                if (out.resourceId === resId) {
                    outputsMap.delete(id);
                    count++;
                }
            }
            return count;
        },
    };

    return { resRepo, processedRepo, learningRepo, resourcesMap, processedMap, outputsMap };
}

/* ── Unit & Integration Tests ───────────────────────────────────────── */

test('1. Resource with no outputs renders empty state', () => {
    const container = createMockElement('div');
    renderLearningOutputs(container, { status: 'empty' });

    assert.equal(container.children.length, 1);
    const emptyEl = container.children[0];
    assert.equal(emptyEl.className, 'learning-outputs-empty');
    assert.ok(emptyEl.children[0].textContent.includes('No learning outputs generated yet'));
});

test('2. Resource with outputs renders the correct sections', () => {
    const container = createMockElement('div');
    const outputs = [
        {
            id: 'out-1',
            type: 'summary',
            content: 'This is the summary.',
            sourceChunkIds: [0],
        },
        {
            id: 'out-2',
            type: 'concept',
            content: 'Photosynthesis',
            sourceChunkIds: [0],
            metadata: { term: 'Photosynthesis', score: 3 },
        },
        {
            id: 'out-3',
            type: 'definition',
            content: 'Photosynthesis: A biological process',
            sourceChunkIds: [0],
            metadata: { term: 'Photosynthesis', definition: 'A biological process' },
        },
        {
            id: 'out-4',
            type: 'question',
            content: 'What is photosynthesis?',
            sourceChunkIds: [0],
        },
    ];

    renderLearningOutputs(container, { status: 'ready', outputs });

    const wrapper = container.querySelector('.learning-outputs-section');
    assert.ok(wrapper, 'Expected .learning-outputs-section');
    assert.equal(wrapper.children.length, 4, 'Expected 4 output sections');

    assert.ok(container.querySelector('.output-summary-card'));
    assert.ok(container.querySelector('.output-concepts-card'));
    assert.ok(container.querySelector('.output-definitions-card'));
    assert.ok(container.querySelector('.output-questions-card'));
});

test('3. Summary renders correctly with source chunk badge', () => {
    const summaryOutput = {
        id: 'sum-1',
        type: 'summary',
        content: 'Plants convert sunlight into chemical energy.',
        sourceChunkIds: [0, 1],
    };

    const section = renderSummarySection(summaryOutput);
    assert.equal(section.dataset.outputType, 'summary');
    assert.equal(section.dataset.outputId, 'sum-1');

    const summaryText = section.querySelector('.output-summary-text');
    assert.equal(summaryText.textContent, 'Plants convert sunlight into chemical energy.');

    const badge = section.querySelector('.source-trace-badge');
    assert.ok(badge);
    assert.equal(badge.textContent, 'Chunks 1, 2');
});

test('4. Concepts render correctly with terms, scores, and source badges', () => {
    const concepts = [
        {
            id: 'con-1',
            type: 'concept',
            content: 'Chloroplasts',
            sourceChunkIds: [0],
            metadata: { term: 'Chloroplasts', score: 4 },
        },
        {
            id: 'con-2',
            type: 'concept',
            content: 'Chlorophyll',
            sourceChunkIds: [1],
            metadata: { term: 'Chlorophyll', score: 1 },
        },
    ];

    const section = renderConceptsSection(concepts);
    assert.equal(section.dataset.outputType, 'concept');

    const chips = section.querySelectorAll('.concept-chip');
    assert.equal(chips.length, 2);

    const term1 = chips[0].querySelector('.concept-term');
    assert.equal(term1.textContent, 'Chloroplasts');

    const score1 = chips[0].querySelector('.concept-score');
    assert.equal(score1.textContent, '×4');

    const badge1 = chips[0].querySelector('.source-trace-badge');
    assert.equal(badge1.textContent, 'Chunk 1');

    // Score 1 should not render score multiplier
    const score2 = chips[1].querySelector('.concept-score');
    assert.equal(score2, null);
});

test('5. Definitions render correctly with term and description separation', () => {
    const defs = [
        {
            id: 'def-1',
            type: 'definition',
            content: 'Mitochondria: The powerhouse of the cell',
            sourceChunkIds: [0],
            metadata: { term: 'Mitochondria', definition: 'The powerhouse of the cell' },
        },
    ];

    const section = renderDefinitionsSection(defs);
    assert.equal(section.dataset.outputType, 'definition');

    const card = section.querySelector('.definition-card');
    assert.equal(card.querySelector('.definition-term').textContent, 'Mitochondria');
    assert.equal(card.querySelector('.definition-desc').textContent, 'The powerhouse of the cell');
    assert.equal(card.querySelector('.source-trace-badge').textContent, 'Chunk 1');
});

test('6. Questions render correctly as a numbered list', () => {
    const questions = [
        {
            id: 'q-1',
            type: 'question',
            content: 'What is the role of mitochondria?',
            sourceChunkIds: [0],
        },
        {
            id: 'q-2',
            type: 'question',
            content: 'How does cellular respiration generate ATP?',
            sourceChunkIds: [1],
        },
    ];

    const section = renderQuestionsSection(questions);
    assert.equal(section.dataset.outputType, 'question');

    const items = section.querySelectorAll('.question-item');
    assert.equal(items.length, 2);
    assert.equal(items[0].querySelector('.question-text').textContent, 'What is the role of mitochondria?');
    assert.equal(items[1].querySelector('.question-text').textContent, 'How does cellular respiration generate ATP?');
    assert.equal(items[0].querySelector('.source-trace-badge').textContent, 'Chunk 1');
});

function makeValidResource(overrides = {}) {
    return {
        id: overrides.id || 'res-' + Math.random().toString(36).slice(2, 8),
        title: overrides.title || 'Sample Resource',
        type: 'text',
        source: 'manual://text-entry',
        content: overrides.content || 'Photosynthesis is the process by which green plants make food.',
        tags: overrides.tags || ['biology'],
        status: 'completed',
        metadata: overrides.metadata || {},
        createdAt: overrides.createdAt || '2026-09-23T12:00:00.000Z',
        updatedAt: overrides.updatedAt || '2026-09-23T12:00:00.000Z',
    };
}

test('7. Generate action calls the existing service and returns categorized counts', async () => {
    const { resRepo, processedRepo, learningRepo } = createMockRepositories();

    await resRepo.createResource(makeValidResource({
        id: 'res-101',
        title: 'Biology 101',
        content: 'Photosynthesis is the process by which plants make food. Chloroplasts are organelles that capture light.',
    }));

    const result = await generateLearningOutputsForResource('res-101', {
        resRepo,
        processedRepo,
        learningRepo,
    });

    assert.equal(result.resourceId, 'res-101');
    assert.ok(result.outputs.length > 0);
    assert.ok(result.counts.total > 0);

    const summary = await getLearningOutputsSummaryForResource('res-101', { learningRepo });
    assert.equal(summary.hasOutputs, true);
    assert.equal(summary.total, result.outputs.length);
});

test('8. Generation failure produces an error state', () => {
    const container = createMockElement('div');
    renderLearningOutputs(container, {
        status: 'error',
        errorMessage: 'Cannot generate learning outputs for empty content.',
    });

    const errorEl = container.querySelector('.learning-outputs-error');
    assert.ok(errorEl);
    assert.equal(errorEl.querySelector('.form-error').textContent, 'Cannot generate learning outputs for empty content.');
});

test('9. Regeneration does not duplicate outputs and replaces previous outputs', async () => {
    const { resRepo, processedRepo, learningRepo } = createMockRepositories();

    await resRepo.createResource(makeValidResource({
        id: 'res-regen',
        title: 'Regeneration Test',
        content: 'Mitochondria are organelles that produce energy. Cellular respiration is how cells break down glucose.',
    }));

    // Run 1
    const run1 = await generateLearningOutputsForResource('res-regen', { resRepo, processedRepo, learningRepo });
    const count1 = run1.outputs.length;

    // Run 2 (Regeneration)
    const run2 = await generateLearningOutputsForResource('res-regen', { resRepo, processedRepo, learningRepo });
    const count2 = run2.outputs.length;

    const storedOutputs = await learningRepo.getLearningOutputsByResourceId('res-regen');
    assert.equal(storedOutputs.length, count2, 'Stored outputs count should match run 2, not run1 + run2');
    assert.equal(count1, count2);
});

test('10. Existing resource data remains intact after output generation', async () => {
    const { resRepo, processedRepo, learningRepo } = createMockRepositories();

    const originalResource = makeValidResource({
        id: 'res-intact',
        title: 'Original Title',
        source: 'manual://custom',
        content: 'DNA is genetic material. RNA is messenger material.',
        tags: ['genetics', 'biology'],
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
    });

    await resRepo.createResource(originalResource);

    await generateLearningOutputsForResource('res-intact', { resRepo, processedRepo, learningRepo });

    const resourceAfter = await resRepo.getResource('res-intact');
    assert.equal(resourceAfter.id, originalResource.id);
    assert.equal(resourceAfter.title, originalResource.title);
    assert.equal(resourceAfter.content, originalResource.content);
    assert.equal(resourceAfter.createdAt, originalResource.createdAt);
    assert.deepEqual(resourceAfter.tags, originalResource.tags);
});

test('11. Unsafe user-provided content is rendered safely as text without HTML interpretation', () => {
    const container = createMockElement('div');
    const malicious = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

    const unsafeOutputs = [
        {
            id: 'xss-1',
            type: 'summary',
            content: malicious,
            sourceChunkIds: [0],
        },
        {
            id: 'xss-2',
            type: 'concept',
            content: malicious,
            sourceChunkIds: [0],
            metadata: { term: malicious, score: 2 },
        },
        {
            id: 'xss-3',
            type: 'definition',
            content: `${malicious}: ${malicious}`,
            sourceChunkIds: [0],
            metadata: { term: malicious, definition: malicious },
        },
        {
            id: 'xss-4',
            type: 'question',
            content: malicious,
            sourceChunkIds: [0],
        },
    ];

    renderLearningOutputs(container, { status: 'ready', outputs: unsafeOutputs });

    // Verify all text properties contain raw string, not executed HTML
    const summaryText = container.querySelector('.output-summary-text');
    assert.equal(summaryText.textContent, malicious);

    const conceptTerm = container.querySelector('.concept-term');
    assert.equal(conceptTerm.textContent, malicious);

    const defTerm = container.querySelector('.definition-term');
    assert.equal(defTerm.textContent, malicious);

    const questionText = container.querySelector('.question-text');
    assert.equal(questionText.textContent, malicious);

    // Verify that element does NOT have innerHTML assigned
    assert.equal(Object.hasOwn(summaryText, 'innerHTML'), false);
    assert.equal(Object.hasOwn(conceptTerm, 'innerHTML'), false);
    assert.equal(Object.hasOwn(defTerm, 'innerHTML'), false);
    assert.equal(Object.hasOwn(questionText, 'innerHTML'), false);
});

test('12. Outputs remain available after reloading/reopening the resource', async () => {
    const { resRepo, processedRepo, learningRepo } = createMockRepositories();

    await resRepo.createResource(makeValidResource({
        id: 'res-persist',
        title: 'Persistence Check',
        content: 'Photosynthesis occurs in chloroplasts. Chlorophyll is the green pigment in leaves.',
    }));

    // Generate once
    await generateLearningOutputsForResource('res-persist', { resRepo, processedRepo, learningRepo });

    // Simulate closing and reopening (querying again)
    const reopenedSummary = await getLearningOutputsSummaryForResource('res-persist', { learningRepo });
    assert.equal(reopenedSummary.hasOutputs, true);
    assert.ok(reopenedSummary.outputs.length > 0);

    // Rendering reopened data
    const container = createMockElement('div');
    renderLearningOutputs(container, { status: 'ready', outputs: reopenedSummary.outputs });

    assert.ok(container.querySelector('.output-summary-card'));
    assert.ok(container.querySelector('.output-concepts-card'));
    assert.ok(container.querySelector('.output-definitions-card'));
    assert.ok(container.querySelector('.output-questions-card'));
});

test('formatSourceChunks formats numbers, strings, and ranges correctly', () => {
    assert.equal(formatSourceChunks([]), '');
    assert.equal(formatSourceChunks(null), '');
    assert.equal(formatSourceChunks([0]), 'Chunk 1');
    assert.equal(formatSourceChunks([0, 1]), 'Chunks 1, 2');
    assert.equal(formatSourceChunks(['chunk-0', 'chunk-1']), 'Chunks 1, 2');
    assert.equal(formatSourceChunks(['custom-id']), 'Chunk custom-id');
});

test('renderLoadingState produces spinner and loading message', () => {
    const loadingEl = renderLoadingState('Custom loading…');
    assert.equal(loadingEl.className, 'learning-outputs-loading');
    assert.ok(loadingEl.querySelector('.learning-outputs-spinner'));
    assert.equal(loadingEl.querySelector('.form-helper').textContent, 'Custom loading…');
});
