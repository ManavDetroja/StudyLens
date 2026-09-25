import test from 'node:test';
import assert from 'node:assert/strict';

import { generateFlashcards } from '../js/processing/flashcardGenerator.js';
import {
    generateFlashcardsForResource,
    getFlashcardsForResource,
    getFlashcardDecks,
    deleteFlashcardsForResource,
    getFlashcardCount,
} from '../js/features/flashcardService.js';
import {
    createDeckCard,
    renderFlashcardDecks,
} from '../js/features/flashcardPage.js';
import {
    renderFlashcardsSection,
} from '../js/features/learningOutputView.js';
import { validateLearningOutput } from '../js/storage/learningOutputValidation.js';

/* ── Minimal Mock DOM for Node unit tests ────────────────────────── */

function createMockElement(tagName = 'div') {
    const listeners = new Map();

    return {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        title: '',
        hidden: false,
        dataset: {},
        attributes: {},
        style: {},
        children: [],
        addEventListener(event, fn) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(fn);
        },
        dispatchEvent(event) {
            const handlers = listeners.get(event.type) || [];
            handlers.forEach((h) => h(event));
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return this.attributes[name] ?? null;
        },
        removeAttribute(name) {
            delete this.attributes[name];
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

function createMockDocument() {
    const root = createMockElement('html');
    const body = createMockElement('body');
    root.children.push(body);

    return {
        createElement(tagName) {
            return createMockElement(tagName);
        },
        querySelector(selector) {
            return root.querySelector(selector);
        },
        querySelectorAll(selector) {
            return root.querySelectorAll(selector);
        },
        body,
        _root: root,
    };
}

/* ── Test Fixtures ───────────────────────────────────────────────── */

const SAMPLE_LEARNING_OUTPUTS = [
    {
        id: 'out-def-1',
        resourceId: 'res-bio-1',
        type: 'definition',
        content: 'Photosynthesis: the process by which green plants convert light into chemical energy',
        sourceChunkIds: [0],
        metadata: {
            term: 'Photosynthesis',
            definition: 'the process by which green plants convert light into chemical energy',
            generator: 'deterministic-pattern',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
    },
    {
        id: 'out-q-1',
        resourceId: 'res-bio-1',
        type: 'question',
        content: 'What is Chloroplast?',
        sourceChunkIds: [1],
        metadata: {
            relatedTerm: 'Chloroplast',
            generator: 'deterministic-pattern',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
    },
    {
        id: 'out-concept-1',
        resourceId: 'res-bio-1',
        type: 'concept',
        content: 'Thylakoid Membrane',
        sourceChunkIds: [1, 2],
        metadata: {
            term: 'Thylakoid Membrane',
            score: 3,
            generator: 'deterministic-frequency',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
    },
];

function createMockRepositories() {
    const resources = new Map();
    const learningOutputs = new Map();

    const resRepo = {
        async getResource(id) {
            return resources.get(id) ? { ...resources.get(id) } : null;
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
        async getLearningOutputsByType(type) {
            return [...learningOutputs.values()].filter((o) => o.type === type);
        },
        async deleteLearningOutput(id) {
            return learningOutputs.delete(id);
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
    };

    return { resRepo, learningRepo, resources, learningOutputs };
}

/* ── 1. Flashcard Generator Unit Tests ────────────────────────────── */

test('1. Generator produces flashcards from definitions with front as term and back as definition', () => {
    const flashcards = generateFlashcards(SAMPLE_LEARNING_OUTPUTS, 'res-bio-1');
    const defCard = flashcards.find((c) => c.metadata.sourceType === 'definition');

    assert.ok(defCard);
    assert.equal(defCard.content.front, 'Photosynthesis');
    assert.equal(defCard.content.back, 'the process by which green plants convert light into chemical energy');
    assert.equal(defCard.type, 'flashcard');
});

test('2. Generator produces flashcards from questions with factual review hint on back', () => {
    const flashcards = generateFlashcards(SAMPLE_LEARNING_OUTPUTS, 'res-bio-1');
    const qCard = flashcards.find((c) => c.metadata.sourceType === 'question');

    assert.ok(qCard);
    assert.equal(qCard.content.front, 'What is Chloroplast?');
    assert.equal(qCard.content.back, 'Review concept: Chloroplast');
    assert.equal(qCard.type, 'flashcard');
});

test('3. Generator produces flashcards from concepts with recall prompt', () => {
    const flashcards = generateFlashcards(SAMPLE_LEARNING_OUTPUTS, 'res-bio-1');
    const conceptCard = flashcards.find((c) => c.metadata.sourceType === 'concept');

    assert.ok(conceptCard);
    assert.equal(conceptCard.content.front, 'What is Thylakoid Membrane?');
    assert.equal(conceptCard.content.back, 'Key concept identified in this resource.');
    assert.equal(conceptCard.type, 'flashcard');
});

test('4. Generator returns empty array when given empty outputs or outputs without usable terms', () => {
    const emptyCards = generateFlashcards([], 'res-bio-1');
    assert.deepEqual(emptyCards, []);

    const nonUsable = generateFlashcards([{ type: 'summary', content: 'Summary only', sourceChunkIds: [] }], 'res-bio-1');
    assert.deepEqual(nonUsable, []);
});

test('5. Generator strictly preserves sourceChunkIds from source learning outputs', () => {
    const flashcards = generateFlashcards(SAMPLE_LEARNING_OUTPUTS, 'res-bio-1');

    const defCard = flashcards.find((c) => c.metadata.sourceType === 'definition');
    assert.deepEqual(defCard.sourceChunkIds, [0]);

    const conceptCard = flashcards.find((c) => c.metadata.sourceType === 'concept');
    assert.deepEqual(conceptCard.sourceChunkIds, [1, 2]);
});

test('6. All generated flashcards have type: flashcard and pass LearningOutput schema validation', () => {
    const flashcards = generateFlashcards(SAMPLE_LEARNING_OUTPUTS, 'res-bio-1');

    assert.equal(flashcards.length, 3);
    flashcards.forEach((card) => {
        assert.equal(card.type, 'flashcard');
        assert.doesNotThrow(() => validateLearningOutput(card));
    });
});

test('7. All flashcard content is structured { front, back } object', () => {
    const flashcards = generateFlashcards(SAMPLE_LEARNING_OUTPUTS, 'res-bio-1');

    flashcards.forEach((card) => {
        assert.equal(typeof card.content, 'object');
        assert.ok(card.content.front);
        assert.ok(card.content.back);
    });
});

test('8. Generator does not fabricate answers or hallucinate information', () => {
    const outputs = [
        {
            id: 'q-no-term',
            resourceId: 'res-1',
            type: 'question',
            content: 'How does this process work?',
            sourceChunkIds: [0],
            metadata: {},
            createdAt: '2026-09-25T10:00:00.000Z',
            updatedAt: '2026-09-25T10:00:00.000Z',
        },
    ];

    const cards = generateFlashcards(outputs, 'res-1');
    assert.equal(cards.length, 1);
    // Back should be an honest factual referral to source material, not an invented answer
    assert.equal(cards[0].content.back, 'Review the source material for this question.');
});

/* ── 2. Flashcard Service Tests ──────────────────────────────────── */

test('9. generateFlashcardsForResource generates and persists flashcards in repository', async () => {
    const { resRepo, learningRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-bio-1', {
        id: 'res-bio-1',
        title: 'Biology 101',
        content: 'Photosynthesis content',
    });

    for (const item of SAMPLE_LEARNING_OUTPUTS) {
        learningOutputs.set(item.id, { ...item });
    }

    const result = await generateFlashcardsForResource('res-bio-1', { resRepo, learningRepo });

    assert.equal(result.resourceId, 'res-bio-1');
    assert.equal(result.count, 3);
    assert.equal(result.flashcards.length, 3);

    const saved = await learningRepo.getLearningOutputsByType('flashcard');
    assert.equal(saved.length, 3);
});

test('10. Regeneration replaces old flashcards without creating duplicates', async () => {
    const { resRepo, learningRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-bio-1', {
        id: 'res-bio-1',
        title: 'Biology 101',
        content: 'Photosynthesis content',
    });

    for (const item of SAMPLE_LEARNING_OUTPUTS) {
        learningOutputs.set(item.id, { ...item });
    }

    // First generation
    await generateFlashcardsForResource('res-bio-1', { resRepo, learningRepo });
    const count1 = (await learningRepo.getLearningOutputsByType('flashcard')).length;
    assert.equal(count1, 3);

    // Second generation (regeneration)
    await generateFlashcardsForResource('res-bio-1', { resRepo, learningRepo });
    const count2 = (await learningRepo.getLearningOutputsByType('flashcard')).length;

    // Count must remain 3, not double to 6
    assert.equal(count2, 3);
});

test('11. generateFlashcardsForResource rejects invalid resourceId', async () => {
    await assert.rejects(
        () => generateFlashcardsForResource(''),
        /valid resourceId is required/i,
    );
});

test('12. getFlashcardsForResource returns only flashcards for specified resource', async () => {
    const { resRepo, learningRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-1', { id: 'res-1', title: 'Resource 1' });
    resources.set('res-2', { id: 'res-2', title: 'Resource 2' });

    for (const item of SAMPLE_LEARNING_OUTPUTS) {
        learningOutputs.set(item.id, { ...item, resourceId: 'res-1' });
    }

    await generateFlashcardsForResource('res-1', { resRepo, learningRepo });

    const cardsForRes1 = await getFlashcardsForResource('res-1', { learningRepo });
    const cardsForRes2 = await getFlashcardsForResource('res-2', { learningRepo });

    assert.equal(cardsForRes1.length, 3);
    assert.equal(cardsForRes2.length, 0);
});

test('13. deleteFlashcardsForResource removes only flashcards for specified resource', async () => {
    const { resRepo, learningRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-1', { id: 'res-1', title: 'Resource 1' });
    for (const item of SAMPLE_LEARNING_OUTPUTS) {
        learningOutputs.set(item.id, { ...item, resourceId: 'res-1' });
    }

    await generateFlashcardsForResource('res-1', { resRepo, learningRepo });
    assert.equal((await getFlashcardsForResource('res-1', { learningRepo })).length, 3);

    const deletedCount = await deleteFlashcardsForResource('res-1', { learningRepo });
    assert.equal(deletedCount, 3);

    const remaining = await getFlashcardsForResource('res-1', { learningRepo });
    assert.equal(remaining.length, 0);

    // Non-flashcard outputs must NOT be deleted
    const definitions = (await learningRepo.getLearningOutputsByResourceId('res-1')).filter((o) => o.type === 'definition');
    assert.equal(definitions.length, 1);
});

test('14. getFlashcardDecks groups flashcards by resource with title and count', async () => {
    const { resRepo, learningRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-1', { id: 'res-1', title: 'Biology Chapter 1' });
    for (const item of SAMPLE_LEARNING_OUTPUTS) {
        learningOutputs.set(item.id, { ...item, resourceId: 'res-1' });
    }

    await generateFlashcardsForResource('res-1', { resRepo, learningRepo });

    const decks = await getFlashcardDecks({ resRepo, learningRepo });
    assert.equal(decks.length, 1);
    assert.equal(decks[0].resourceId, 'res-1');
    assert.equal(decks[0].title, 'Biology Chapter 1');
    assert.equal(decks[0].count, 3);
});

test('15. getFlashcardCount returns total count of all flashcards in storage', async () => {
    const { resRepo, learningRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-1', { id: 'res-1', title: 'Biology Chapter 1' });
    for (const item of SAMPLE_LEARNING_OUTPUTS) {
        learningOutputs.set(item.id, { ...item, resourceId: 'res-1' });
    }

    await generateFlashcardsForResource('res-1', { resRepo, learningRepo });
    const count = await getFlashcardCount({ learningRepo });
    assert.equal(count, 3);
});

/* ── 3. DOM & UI Component Tests ─────────────────────────────────── */

test('16. createDeckCard creates an accessible article with deck title, badge, and study button', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        const deck = {
            resourceId: 'res-42',
            title: 'Cellular Respiration',
            count: 5,
            flashcards: [
                {
                    content: { front: 'Glycolysis', back: 'Breakdown of glucose' },
                },
            ],
        };

        const cardEl = createDeckCard(deck);
        assert.equal(cardEl.tagName, 'ARTICLE');
        assert.ok(cardEl.className.includes('flashcard-deck-card'));

        const titleEl = cardEl.querySelector('.flashcard-deck-title');
        assert.equal(titleEl.textContent, 'Cellular Respiration');

        const badgeEl = cardEl.querySelector('.flashcard-deck-badge');
        assert.equal(badgeEl.textContent, '5 cards');

        const studyBtn = cardEl.querySelector('[data-study-deck]');
        assert.ok(studyBtn);
        assert.equal(studyBtn.textContent, 'Study deck');
    } finally {
        globalThis.document = origDoc;
    }
});

test('17. renderFlashcardDecks renders deck cards and hides empty state when decks exist', () => {
    const origDoc = globalThis.document;
    const mockDoc = createMockDocument();
    globalThis.document = mockDoc;

    try {
        const emptyEl = mockDoc.createElement('div');
        emptyEl.dataset.flashcardsEmpty = '';
        mockDoc.body.append(emptyEl);

        const decksEl = mockDoc.createElement('div');
        decksEl.dataset.flashcardsDecks = '';
        mockDoc.body.append(decksEl);

        const decks = [
            {
                resourceId: 'res-1',
                title: 'Genetics',
                count: 3,
                flashcards: [],
            },
        ];

        renderFlashcardDecks(decks);

        assert.equal(emptyEl.hidden, true);
        assert.equal(decksEl.hidden, false);
        assert.equal(decksEl.children.length, 1);
    } finally {
        globalThis.document = origDoc;
    }
});

test('18. renderFlashcardDecks shows empty state and clears decks when list is empty', () => {
    const origDoc = globalThis.document;
    const mockDoc = createMockDocument();
    globalThis.document = mockDoc;

    try {
        const emptyEl = mockDoc.createElement('div');
        emptyEl.dataset.flashcardsEmpty = '';
        mockDoc.body.append(emptyEl);

        const decksEl = mockDoc.createElement('div');
        decksEl.dataset.flashcardsDecks = '';
        mockDoc.body.append(decksEl);

        renderFlashcardDecks([]);

        assert.equal(emptyEl.hidden, false);
        assert.equal(decksEl.hidden, true);
        assert.equal(decksEl.children.length, 0);
    } finally {
        globalThis.document = origDoc;
    }
});

test('19. renderFlashcardsSection in learningOutputView renders flashcard preview with source badges', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        const cards = [
            {
                id: 'fc-1',
                type: 'flashcard',
                content: { front: 'Osmosis', back: 'Diffusion of water' },
                sourceChunkIds: [0],
            },
        ];

        const section = renderFlashcardsSection(cards);
        assert.equal(section.tagName, 'ARTICLE');
        assert.ok(section.className.includes('output-flashcards-card'));

        const frontEl = section.querySelector('.flashcard-preview-front');
        assert.equal(frontEl.textContent, 'Osmosis');

        const badgeEl = section.querySelector('.source-trace-badge');
        assert.ok(badgeEl);
        assert.equal(badgeEl.textContent, 'Chunk 1');
    } finally {
        globalThis.document = origDoc;
    }
});

test('20. renderFlashcardsSection triggers study button click callback', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        let studyClicked = false;
        const cards = [
            {
                id: 'fc-1',
                type: 'flashcard',
                content: { front: 'Enzyme', back: 'Biological catalyst' },
                sourceChunkIds: [0],
            },
        ];

        const section = renderFlashcardsSection(cards, () => {
            studyClicked = true;
        });

        const studyBtn = section.querySelector('[data-study-flashcards-btn]');
        assert.ok(studyBtn);
        studyBtn.dispatchEvent({ type: 'click' });
        assert.equal(studyClicked, true);
    } finally {
        globalThis.document = origDoc;
    }
});

test('21. Safe text rendering: flashcard front, back, and deck title use textContent', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        const maliciousDeck = {
            resourceId: 'res-xss',
            title: '<img src=x onerror=alert(1)>',
            count: 1,
            flashcards: [
                {
                    content: {
                        front: '<script>alert("xss")</script>',
                        back: '<b onmouseover=alert(2)>Back</b>',
                    },
                    sourceChunkIds: [],
                },
            ],
        };

        const cardEl = createDeckCard(maliciousDeck);
        const titleEl = cardEl.querySelector('.flashcard-deck-title');
        // Must be literal string in textContent, not executed as HTML
        assert.equal(titleEl.textContent, '<img src=x onerror=alert(1)>');

        const section = renderFlashcardsSection(maliciousDeck.flashcards);
        const frontEl = section.querySelector('.flashcard-preview-front');
        assert.equal(frontEl.textContent, '<script>alert("xss")</script>');
    } finally {
        globalThis.document = origDoc;
    }
});
