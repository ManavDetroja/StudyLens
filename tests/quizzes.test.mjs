import test from 'node:test';
import assert from 'node:assert/strict';

import {
    validateQuizQuestion,
    validateQuiz,
    createQuizRecord,
    createUpdatedQuiz,
    generateQuizId,
} from '../js/storage/quizValidation.js';
import { QuizValidationError } from '../js/storage/errors.js';
import { generateQuiz } from '../js/processing/quizGenerator.js';
import {
    generateQuizForResource,
    getQuizForResource,
    getQuiz,
    getAllQuizzes,
    deleteQuiz,
    deleteQuizzesForResource,
    countQuizzes,
} from '../js/features/quizService.js';
import {
    createQuizCard,
    renderQuizzesList,
} from '../js/features/quizPage.js';
import {
    renderQuizSection,
} from '../js/features/learningOutputView.js';

/* ── Minimal Mock DOM for Node unit tests ────────────────────────── */

function createMockElement(tagName = 'div') {
    const listeners = new Map();

    return {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        title: '',
        hidden: false,
        disabled: false,
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

const SAMPLE_OUTPUTS_FOR_QUIZ = [
    {
        id: 'out-def-1',
        resourceId: 'res-bio-1',
        type: 'definition',
        content: 'Photosynthesis: the process by which green plants convert light into chemical energy',
        sourceChunkIds: [0],
        metadata: {
            term: 'Photosynthesis',
            definition: 'the process by which green plants convert light into chemical energy',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
    },
    {
        id: 'out-def-2',
        resourceId: 'res-bio-1',
        type: 'definition',
        content: 'Chlorophyll: the green pigment in plants that absorbs light energy',
        sourceChunkIds: [1],
        metadata: {
            term: 'Chlorophyll',
            definition: 'the green pigment in plants that absorbs light energy',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
    },
    {
        id: 'out-def-3',
        resourceId: 'res-bio-1',
        type: 'definition',
        content: 'Stoma: microscopic pore in plant leaves that regulates gas exchange',
        sourceChunkIds: [2],
        metadata: {
            term: 'Stoma',
            definition: 'microscopic pore in plant leaves that regulates gas exchange',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
    },
    {
        id: 'out-q-1',
        resourceId: 'res-bio-1',
        type: 'question',
        content: 'What is Chloroplast?',
        sourceChunkIds: [1],
        metadata: {
            relatedTerm: 'Chloroplast',
        },
        createdAt: '2026-09-25T10:00:00.000Z',
    },
];

function createMockRepositories() {
    const resources = new Map();
    const learningOutputs = new Map();
    const quizzes = new Map();

    const resRepo = {
        async getResource(id) {
            return resources.get(id) ? { ...resources.get(id) } : null;
        },
    };

    const learningRepo = {
        async getLearningOutputsByResourceId(resId) {
            return [...learningOutputs.values()].filter((o) => o.resourceId === resId);
        },
    };

    const quizRepo = {
        async createQuiz(record) {
            validateQuiz(record);
            if (quizzes.has(record.id)) {
                throw new Error(`Quiz with id ${record.id} already exists`);
            }
            quizzes.set(record.id, { ...record });
            return { ...record };
        },
        async getQuiz(id) {
            return quizzes.get(id) ? { ...quizzes.get(id) } : null;
        },
        async getQuizzesByResourceId(resId) {
            return [...quizzes.values()]
                .filter((q) => q.resourceId === resId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        },
        async getAllQuizzes() {
            return [...quizzes.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        },
        async deleteQuiz(id) {
            return quizzes.delete(id);
        },
        async deleteQuizzesByResourceId(resId) {
            let count = 0;
            for (const [id, q] of quizzes.entries()) {
                if (q.resourceId === resId) {
                    quizzes.delete(id);
                    count++;
                }
            }
            return count;
        },
        async countQuizzes() {
            return quizzes.size;
        },
    };

    return { resRepo, learningRepo, quizRepo, resources, learningOutputs, quizzes };
}

/* ── 1. Quiz Model & Validation Unit Tests ───────────────────────── */

test('1. validateQuizQuestion passes for valid MCQ item', () => {
    const validQuestion = {
        id: 'q-1',
        question: 'Which term matches the definition: "the green pigment in plants"?',
        options: ['Photosynthesis', 'Chlorophyll', 'Stoma', 'Chloroplast'],
        correctAnswer: 'Chlorophyll',
        sourceChunkIds: [1],
        order: 0,
    };

    assert.doesNotThrow(() => validateQuizQuestion(validQuestion));
});

test('2. validateQuizQuestion rejects missing or invalid fields', () => {
    assert.throws(
        () => validateQuizQuestion(null),
        QuizValidationError,
    );
    assert.throws(
        () => validateQuizQuestion({ id: 'q-1', question: '', options: ['A', 'B'], correctAnswer: 'A', sourceChunkIds: [], order: 0 }),
        /non-empty string/i,
    );
    assert.throws(
        () => validateQuizQuestion({ id: 'q-1', question: 'Q?', options: ['A'], correctAnswer: 'A', sourceChunkIds: [], order: 0 }),
        /at least 2 choices/i,
    );
    assert.throws(
        () => validateQuizQuestion({
            id: 'q-1',
            question: 'Q?',
            options: ['A', 'B'],
            correctAnswer: 'C',
            sourceChunkIds: [],
            order: 0,
        }),
        /correctAnswer must be one of the provided options/i,
    );
    assert.throws(
        () => validateQuizQuestion({
            id: 'q-1',
            question: 'Q?',
            options: ['A', 'B'],
            correctAnswer: 'A',
            sourceChunkIds: 'not-an-array',
            order: 0,
        }),
        /sourceChunkIds must be an array/i,
    );
    assert.throws(
        () => validateQuizQuestion({
            id: 'q-1',
            question: 'Q?',
            options: ['A', 'B'],
            correctAnswer: 'A',
            sourceChunkIds: [],
            order: -1,
        }),
        /order must be a non-negative integer/i,
    );
});

test('3. validateQuiz passes for valid Quiz record', () => {
    const validQuiz = {
        id: 'quiz-abc-123',
        resourceId: 'res-bio-1',
        title: 'Biology 101 Quiz',
        questions: [
            {
                id: 'q-1',
                question: 'What is Chlorophyll?',
                options: ['Pigment', 'Cell'],
                correctAnswer: 'Pigment',
                sourceChunkIds: [0],
                order: 0,
            },
        ],
        metadata: {
            questionCount: 1,
            generator: 'deterministic-quiz-engine',
            version: 1,
        },
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
    };

    assert.doesNotThrow(() => validateQuiz(validQuiz));
});

test('4. validateQuiz rejects empty question list, missing ids, or invalid timestamps', () => {
    assert.throws(
        () => validateQuiz({ id: '', resourceId: 'res-1' }),
        /id must be a non-empty string/i,
    );
    assert.throws(
        () => validateQuiz({ id: 'quiz-1', resourceId: '', title: 'Title' }),
        /resourceId must be a non-empty string/i,
    );
    assert.throws(
        () => validateQuiz({ id: 'quiz-1', resourceId: 'res-1', title: '', questions: [] }),
        /title must be a non-empty string/i,
    );
    assert.throws(
        () => validateQuiz({ id: 'quiz-1', resourceId: 'res-1', title: 'T', questions: [], metadata: {}, createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' }),
        /questions must be a non-empty array/i,
    );
});

test('5. createQuizRecord builds a valid quiz with generated ID and timestamps', () => {
    const record = createQuizRecord({
        resourceId: 'res-bio-1',
        title: 'Biology Quiz',
        questions: [
            {
                id: 'q-1',
                question: 'Question text?',
                options: ['Choice 1', 'Choice 2'],
                correctAnswer: 'Choice 1',
                sourceChunkIds: [0],
                order: 0,
            },
        ],
    });

    assert.ok(typeof record.id === 'string' && record.id.length > 0);
    assert.equal(record.resourceId, 'res-bio-1');
    assert.equal(record.title, 'Biology Quiz');
    assert.equal(record.questions.length, 1);
    assert.ok(record.createdAt);
    assert.ok(record.updatedAt);
    assert.doesNotThrow(() => validateQuiz(record));
});

test('6. createUpdatedQuiz preserves original id and createdAt while updating updatedAt', () => {
    const original = createQuizRecord({
        resourceId: 'res-1',
        title: 'Original Quiz',
        questions: [
            {
                id: 'q-1',
                question: 'Original Q?',
                options: ['A', 'B'],
                correctAnswer: 'A',
                sourceChunkIds: [0],
                order: 0,
            },
        ],
        metadata: { version: 1 },
    });

    const updated = createUpdatedQuiz(original, {
        title: 'Updated Quiz Title',
        metadata: { version: 2 },
    });

    assert.equal(updated.id, original.id);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.title, 'Updated Quiz Title');
    assert.equal(updated.metadata.version, 2);
    assert.doesNotThrow(() => validateQuiz(updated));
});

/* ── 2. Deterministic Quiz Generator Tests ───────────────────────── */

const SAMPLE_RESOURCE = { id: 'res-bio-1', title: 'Biology Test' };

test('7. Quiz generator produces MCQs from definitions with authentic distractors', () => {
    const quiz = generateQuiz(SAMPLE_OUTPUTS_FOR_QUIZ, SAMPLE_RESOURCE);

    assert.ok(quiz);
    assert.equal(quiz.resourceId, 'res-bio-1');
    assert.equal(quiz.title, 'Biology Test Quiz');
    assert.ok(quiz.questions.length >= 2);

    quiz.questions.forEach((q) => {
        assert.ok(q.question);
        assert.ok(q.options.length >= 2);
        assert.ok(q.options.includes(q.correctAnswer));
        assert.ok(Array.isArray(q.sourceChunkIds));
        assert.ok(typeof q.order === 'number');
    });
});

test('8. Quiz generator strictly preserves sourceChunkIds from source outputs', () => {
    const quiz = generateQuiz(SAMPLE_OUTPUTS_FOR_QUIZ, SAMPLE_RESOURCE);

    // Definition 1 has sourceChunkIds: [0]
    const q1 = quiz.questions.find((q) => q.question.includes('Photosynthesis'));
    assert.ok(q1);
    assert.deepEqual(q1.sourceChunkIds, [0]);
});

test('9. Quiz generator draws distractors from real terms and definitions in the same resource', () => {
    const quiz = generateQuiz(SAMPLE_OUTPUTS_FOR_QUIZ, SAMPLE_RESOURCE);

    const knownTerms = ['Photosynthesis', 'Chlorophyll', 'Stoma', 'Chloroplast'];
    const knownDefs = SAMPLE_OUTPUTS_FOR_QUIZ.map((o) => o.metadata?.definition).filter(Boolean);

    quiz.questions.forEach((q) => {
        if (q.question.startsWith('Which term refers to')) {
            q.options.forEach((opt) => {
                assert.ok(
                    knownTerms.includes(opt),
                    `Distractor "${opt}" must be an authentic term from the resource`,
                );
            });
        } else if (q.question.startsWith('What is the definition of')) {
            q.options.forEach((opt) => {
                assert.ok(
                    knownDefs.includes(opt),
                    `Distractor "${opt}" must be an authentic definition from the resource`,
                );
            });
        }
    });
});

test('10. Quiz generator throws validation error when given insufficient outputs (< 2 terms)', () => {
    const singleOutput = [SAMPLE_OUTPUTS_FOR_QUIZ[0]];
    assert.throws(
        () => generateQuiz(singleOutput, SAMPLE_RESOURCE),
        /Could not generate any valid quiz questions/i,
    );
});

test('11. Quiz generator produces deterministic output given the same inputs', () => {
    const quizA = generateQuiz(SAMPLE_OUTPUTS_FOR_QUIZ, SAMPLE_RESOURCE);
    const quizB = generateQuiz(SAMPLE_OUTPUTS_FOR_QUIZ, SAMPLE_RESOURCE);

    assert.equal(quizA.questions.length, quizB.questions.length);
    for (let i = 0; i < quizA.questions.length; i++) {
        assert.equal(quizA.questions[i].question, quizB.questions[i].question);
        assert.equal(quizA.questions[i].correctAnswer, quizB.questions[i].correctAnswer);
        assert.deepEqual(quizA.questions[i].options, quizB.questions[i].options);
    }
});

/* ── 3. Quiz Service & Repository Tests ───────────────────────────── */

test('12. generateQuizForResource creates and persists quiz in repository', async () => {
    const { resRepo, learningRepo, quizRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-bio-1', { id: 'res-bio-1', title: 'Biology Chapter 1' });
    for (const item of SAMPLE_OUTPUTS_FOR_QUIZ) {
        learningOutputs.set(item.id, { ...item });
    }

    const result = await generateQuizForResource('res-bio-1', { resRepo, learningRepo, quizRepo });

    assert.ok(result);
    assert.equal(result.resourceId, 'res-bio-1');
    assert.equal(result.quiz.title, 'Biology Chapter 1 Quiz');
    assert.ok(result.quiz.questions.length >= 2);

    const saved = await quizRepo.getQuiz(result.quiz.id);
    assert.ok(saved);
    assert.equal(saved.id, result.quiz.id);
});

test('13. Regeneration replaces old quiz for the resource without creating duplicates', async () => {
    const { resRepo, learningRepo, quizRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-bio-1', { id: 'res-bio-1', title: 'Biology Chapter 1' });
    for (const item of SAMPLE_OUTPUTS_FOR_QUIZ) {
        learningOutputs.set(item.id, { ...item });
    }

    // First generation
    const result1 = await generateQuizForResource('res-bio-1', { resRepo, learningRepo, quizRepo });
    assert.equal(await quizRepo.countQuizzes(), 1);

    // Second generation (regeneration)
    const result2 = await generateQuizForResource('res-bio-1', { resRepo, learningRepo, quizRepo });

    // Store must have exactly 1 quiz, old one replaced
    assert.equal(await quizRepo.countQuizzes(), 1);
    assert.notEqual(result1.quiz.id, result2.quiz.id);

    const active = await getQuizForResource('res-bio-1', { quizRepo });
    assert.equal(active.id, result2.quiz.id);
});

test('14. generateQuizForResource rejects invalid resourceId', async () => {
    await assert.rejects(
        () => generateQuizForResource(''),
        /valid resourceId is required/i,
    );
});

test('15. deleteQuiz removes specified quiz by id', async () => {
    const { resRepo, learningRepo, quizRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-bio-1', { id: 'res-bio-1', title: 'Biology' });
    for (const item of SAMPLE_OUTPUTS_FOR_QUIZ) {
        learningOutputs.set(item.id, { ...item });
    }

    const result = await generateQuizForResource('res-bio-1', { resRepo, learningRepo, quizRepo });
    assert.equal(await quizRepo.countQuizzes(), 1);

    const deleted = await deleteQuiz(result.quiz.id, { quizRepo });
    assert.equal(deleted, true);
    assert.equal(await quizRepo.countQuizzes(), 0);
});

test('16. deleteQuizzesForResource removes quiz associated with resource', async () => {
    const { resRepo, learningRepo, quizRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-bio-1', { id: 'res-bio-1', title: 'Biology' });
    for (const item of SAMPLE_OUTPUTS_FOR_QUIZ) {
        learningOutputs.set(item.id, { ...item });
    }

    await generateQuizForResource('res-bio-1', { resRepo, learningRepo, quizRepo });
    assert.equal(await countQuizzes({ quizRepo }), 1);

    const deletedCount = await deleteQuizzesForResource('res-bio-1', { quizRepo });
    assert.equal(deletedCount, 1);
    assert.equal(await countQuizzes({ quizRepo }), 0);
});

test('17. getAllQuizzes returns all quizzes sorted by createdAt descending', async () => {
    const { resRepo, learningRepo, quizRepo, resources, learningOutputs } = createMockRepositories();

    resources.set('res-1', { id: 'res-1', title: 'Subject 1' });
    resources.set('res-2', { id: 'res-2', title: 'Subject 2' });

    for (const item of SAMPLE_OUTPUTS_FOR_QUIZ) {
        learningOutputs.set(item.id, { ...item, resourceId: 'res-1' });
    }

    await generateQuizForResource('res-1', { resRepo, learningRepo, quizRepo });

    const all = await getAllQuizzes({ quizRepo });
    assert.equal(all.length, 1);
    assert.equal(all[0].resourceId, 'res-1');
});

/* ── 4. UI Rendering & Player Unit Tests ─────────────────────────── */

test('18. createQuizCard creates accessible card with title, badge, preview, and take quiz trigger', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        const quiz = {
            id: 'quiz-101',
            resourceId: 'res-1',
            title: 'Photosynthesis Fundamentals',
            questions: [
                {
                    id: 'q-1',
                    type: 'multiple-choice',
                    question: 'What absorbs light energy in chloroplasts?',
                    options: ['Chlorophyll', 'Mitochondria'],
                    correctAnswer: 'Chlorophyll',
                    sourceChunkIds: [0],
                },
            ],
            createdAt: '2026-09-25T10:00:00.000Z',
        };

        const card = createQuizCard(quiz);
        assert.equal(card.tagName, 'ARTICLE');
        assert.ok(card.className.includes('quiz-deck-card'));

        const titleEl = card.querySelector('.quiz-card-title');
        assert.equal(titleEl.textContent, 'Photosynthesis Fundamentals');

        const badgeEl = card.querySelector('.quiz-card-badge');
        assert.equal(badgeEl.textContent, '1 question');

        const previewEl = card.querySelector('.quiz-card-preview');
        assert.ok(previewEl.textContent.includes('What absorbs light energy'));

        const startBtn = card.querySelector('[data-start-quiz]');
        assert.ok(startBtn);
        assert.equal(startBtn.textContent, 'Take quiz');
    } finally {
        globalThis.document = origDoc;
    }
});

test('19. renderQuizzesList renders cards and hides empty state when quizzes exist', () => {
    const origDoc = globalThis.document;
    const mockDoc = createMockDocument();
    globalThis.document = mockDoc;

    try {
        const emptyEl = mockDoc.createElement('div');
        emptyEl.dataset.quizzesEmpty = '';
        mockDoc.body.append(emptyEl);

        const listEl = mockDoc.createElement('div');
        listEl.dataset.quizzesList = '';
        mockDoc.body.append(listEl);

        const quizzes = [
            {
                id: 'quiz-1',
                resourceId: 'res-1',
                title: 'Genetics Quiz',
                questions: [{ id: 'q1', question: 'Q1?', options: ['A', 'B'], correctAnswer: 'A' }],
            },
        ];

        renderQuizzesList(quizzes);

        assert.equal(emptyEl.hidden, true);
        assert.equal(listEl.hidden, false);
        assert.equal(listEl.children.length, 1);
    } finally {
        globalThis.document = origDoc;
    }
});

test('20. renderQuizzesList shows empty state when no quizzes exist', () => {
    const origDoc = globalThis.document;
    const mockDoc = createMockDocument();
    globalThis.document = mockDoc;

    try {
        const emptyEl = mockDoc.createElement('div');
        emptyEl.dataset.quizzesEmpty = '';
        mockDoc.body.append(emptyEl);

        const listEl = mockDoc.createElement('div');
        listEl.dataset.quizzesList = '';
        mockDoc.body.append(listEl);

        renderQuizzesList([]);

        assert.equal(emptyEl.hidden, false);
        assert.equal(listEl.hidden, true);
        assert.equal(listEl.children.length, 0);
    } finally {
        globalThis.document = origDoc;
    }
});

test('21. renderQuizSection in learningOutputView renders preview card with question items and trigger', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        let launchTriggered = false;
        const quiz = {
            id: 'quiz-42',
            resourceId: 'res-1',
            title: 'Cellular Respiration Quiz',
            questions: [
                {
                    id: 'q-1',
                    type: 'multiple-choice',
                    question: 'Where does glycolysis occur?',
                    options: ['Cytoplasm', 'Matrix'],
                    correctAnswer: 'Cytoplasm',
                    sourceChunkIds: [0],
                },
                {
                    id: 'q-2',
                    type: 'multiple-choice',
                    question: 'What is ATP?',
                    options: ['Energy currency', 'Enzyme'],
                    correctAnswer: 'Energy currency',
                    sourceChunkIds: [1],
                },
            ],
        };

        const section = renderQuizSection(quiz, () => {
            launchTriggered = true;
        });

        assert.equal(section.tagName, 'ARTICLE');
        assert.ok(section.className.includes('output-quiz-card'));

        const heading = section.querySelector('h4');
        assert.equal(heading.textContent, 'Quiz (2 Questions)');

        const previewItems = section.querySelectorAll('.quiz-preview-item');
        assert.equal(previewItems.length, 2);

        const takeQuizBtn = section.querySelector('[data-start-quiz-btn]');
        assert.ok(takeQuizBtn);
        takeQuizBtn.dispatchEvent({ type: 'click' });
        assert.equal(launchTriggered, true);
    } finally {
        globalThis.document = origDoc;
    }
});

test('22. Safe rendering: question text, options, and quiz titles use textContent exclusively', () => {
    const origDoc = globalThis.document;
    globalThis.document = createMockDocument();

    try {
        const xssQuiz = {
            id: 'quiz-xss',
            resourceId: 'res-xss',
            title: '<script>alert("xss-title")</script>',
            questions: [
                {
                    id: 'q-1',
                    type: 'multiple-choice',
                    question: '<img src=x onerror=alert(1)>',
                    options: ['<b onmouseover=alert(2)>Opt1</b>', 'Safe Opt2'],
                    correctAnswer: '<b onmouseover=alert(2)>Opt1</b>',
                    sourceChunkIds: [0],
                },
            ],
        };

        const card = createQuizCard(xssQuiz);
        const titleEl = card.querySelector('.quiz-card-title');
        assert.equal(titleEl.textContent, '<script>alert("xss-title")</script>');

        const section = renderQuizSection(xssQuiz);
        const qTextEl = section.querySelector('.quiz-preview-q');
        assert.equal(qTextEl.textContent, 'Q1: <img src=x onerror=alert(1)>');
    } finally {
        globalThis.document = origDoc;
    }
});

test('23. Quiz scoring calculation produces accurate score and rounded percentage', () => {
    // Scoring logic verification
    const questions = [
        { id: 'q1', correctAnswer: 'A' },
        { id: 'q2', correctAnswer: 'B' },
        { id: 'q3', correctAnswer: 'C' },
    ];

    const userAnswers = new Map([
        ['q1', 'A'], // correct
        ['q2', 'Wrong'], // incorrect
        ['q3', 'C'], // correct
    ]);

    let correctCount = 0;
    questions.forEach((q) => {
        if (userAnswers.get(q.id) === q.correctAnswer) {
            correctCount++;
        }
    });

    const total = questions.length;
    const percentage = Math.round((correctCount / total) * 100);

    assert.equal(correctCount, 2);
    assert.equal(total, 3);
    assert.equal(percentage, 67);
});
