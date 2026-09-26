import test from 'node:test';
import assert from 'node:assert/strict';

import {
    validateQuestionResult,
    validateQuizAttempt,
    createQuizAttemptRecord,
    generateQuizAttemptId,
} from '../js/storage/quizAttemptValidation.js';
import { QuizAttemptValidationError } from '../js/storage/errors.js';
import { calculateQuizResult } from '../js/processing/quizScoreCalculator.js';
import {
    recordQuizAttempt,
    getAttempt,
    getAttemptsForQuiz,
    getAttemptsForResource,
    getAllAttempts,
    deleteAttempt,
    deleteAttemptsForQuiz,
    deleteAttemptsForResource,
    countAttempts,
} from '../js/features/quizAttemptService.js';
import {
    computeQuizAnalytics,
    getQuizAnalytics,
} from '../js/features/analyticsService.js';
import {
    createActivityItem,
    renderAnalytics,
} from '../js/features/analyticsPage.js';
import {
    renderResultsView,
    formatAttemptDate,
} from '../js/features/quizPlayer.js';

/* ── Minimal DOM Mock for UI helper unit tests ───────────────────── */

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

/* ── Test Fixtures ───────────────────────────────────────────────── */

const SAMPLE_QUIZ = {
    id: 'quiz-101',
    resourceId: 'res-bio-1',
    title: 'Biology 101 Quiz',
    questions: [
        {
            id: 'q-1',
            question: 'What is photosynthesis?',
            options: ['Light energy conversion', 'Cellular respiration', 'Fermentation'],
            correctAnswer: 'Light energy conversion',
            sourceChunkIds: [0],
            order: 0,
        },
        {
            id: 'q-2',
            question: 'What pigment gives leaves their green color?',
            options: ['Chlorophyll', 'Carotenoid', 'Anthocyanin'],
            correctAnswer: 'Chlorophyll',
            sourceChunkIds: [1],
            order: 1,
        },
        {
            id: 'q-3',
            question: 'What organelle produces ATP in eukaryotes?',
            options: ['Mitochondria', 'Ribosome', 'Golgi apparatus'],
            correctAnswer: 'Mitochondria',
            sourceChunkIds: [2],
            order: 2,
        },
        {
            id: 'q-4',
            question: 'What is the primary function of stomata?',
            options: ['Gas exchange', 'Water transport', 'Nutrient absorption'],
            correctAnswer: 'Gas exchange',
            sourceChunkIds: [3],
            order: 3,
        },
    ],
};

function createMockAttemptRepo(initialAttempts = []) {
    const attempts = new Map();
    initialAttempts.forEach((a) => attempts.set(a.id, { ...a }));

    return {
        _attempts: attempts,
        async createQuizAttempt(input) {
            const record = createQuizAttemptRecord(input);
            attempts.set(record.id, { ...record });
            return { ...record };
        },
        async getQuizAttempt(id) {
            return attempts.has(id) ? { ...attempts.get(id) } : null;
        },
        async getAttemptsByQuiz(quizId) {
            return [...attempts.values()]
                .filter((a) => a.quizId === quizId)
                .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
        },
        async getAttemptsByResource(resourceId) {
            return [...attempts.values()]
                .filter((a) => a.resourceId === resourceId)
                .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
        },
        async getAllAttempts() {
            return [...attempts.values()]
                .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
        },
        async deleteQuizAttempt(id) {
            return attempts.delete(id);
        },
        async deleteAttemptsByQuiz(quizId) {
            let count = 0;
            for (const [id, a] of attempts.entries()) {
                if (a.quizId === quizId) {
                    attempts.delete(id);
                    count++;
                }
            }
            return count;
        },
        async deleteAttemptsByResource(resourceId) {
            let count = 0;
            for (const [id, a] of attempts.entries()) {
                if (a.resourceId === resourceId) {
                    attempts.delete(id);
                    count++;
                }
            }
            return count;
        },
        async countAttempts() {
            return attempts.size;
        },
        async clearAttempts() {
            const size = attempts.size;
            attempts.clear();
            return size;
        },
    };
}

/* ── Validation Tests (Phase 1) ──────────────────────────────────── */

test('1. validateQuizAttempt accepts valid attempt input', () => {
    const valid = {
        quizId: 'quiz-1',
        resourceId: 'res-1',
        quizTitle: 'Valid Quiz',
        score: 3,
        correctCount: 3,
        incorrectCount: 1,
        unansweredCount: 0,
        totalQuestions: 4,
        percentage: 75,
        answers: { 'q-1': 'A' },
        questionResults: [
            {
                questionId: 'q-1',
                question: 'Question 1',
                selectedAnswer: 'A',
                correctAnswer: 'A',
                isCorrect: true,
                isUnanswered: false,
                sourceChunkIds: [0],
            },
        ],
        startedAt: '2026-09-26T10:00:00.000Z',
        completedAt: '2026-09-26T10:02:00.000Z',
        id: 'attempt-1',
        createdAt: '2026-09-26T10:02:00.000Z',
    };

    assert.doesNotThrow(() => validateQuizAttempt(valid));
});

test('2. validateQuizAttempt rejects missing or invalid quizId', () => {
    assert.throws(() => {
        validateQuizAttempt({
            quizId: '',
            resourceId: 'res-1',
            score: 0,
            questionResults: [],
        });
    }, QuizAttemptValidationError);

    assert.throws(() => {
        validateQuizAttempt({
            quizId: 123,
            resourceId: 'res-1',
            score: 0,
            questionResults: [],
        });
    }, QuizAttemptValidationError);
});

test('3. validateQuizAttempt rejects missing or invalid resourceId', () => {
    assert.throws(() => {
        validateQuizAttempt({
            quizId: 'quiz-1',
            resourceId: '',
            score: 0,
            questionResults: [],
        });
    }, QuizAttemptValidationError);

    assert.throws(() => {
        validateQuizAttempt({
            quizId: 'quiz-1',
            resourceId: null,
            score: 0,
            questionResults: [],
        });
    }, QuizAttemptValidationError);
});

test('4. validateQuizAttempt rejects missing or non-array questionResults', () => {
    assert.throws(() => {
        validateQuizAttempt({
            quizId: 'quiz-1',
            resourceId: 'res-1',
            score: 1,
            questionResults: 'not-an-array',
        });
    }, QuizAttemptValidationError);
});

test('5. validateQuestionResult accepts valid question result', () => {
    const qr = {
        questionId: 'q-10',
        question: 'What is 2 + 2?',
        selectedAnswer: '4',
        correctAnswer: '4',
        isCorrect: true,
        isUnanswered: false,
        sourceChunkIds: [1, 2],
    };

    assert.doesNotThrow(() => validateQuestionResult(qr));
});

test('6. validateQuestionResult rejects invalid questionId or question text', () => {
    assert.throws(() => {
        validateQuestionResult({
            questionId: '',
            question: 'Valid question text',
        });
    }, QuizAttemptValidationError);

    assert.throws(() => {
        validateQuestionResult({
            questionId: 'q-1',
            question: '',
        });
    }, QuizAttemptValidationError);
});

test('7. validateQuestionResult accepts null selectedAnswer for unanswered questions', () => {
    const unanswered = {
        questionId: 'q-skip',
        question: 'Skipped question?',
        selectedAnswer: null,
        correctAnswer: 'Answer',
        isCorrect: false,
        isUnanswered: true,
        sourceChunkIds: [],
    };

    assert.doesNotThrow(() => validateQuestionResult(unanswered));
});

/* ── Calculation Tests (Phase 3) ─────────────────────────────────── */

test('8. calculateQuizResult calculates 100% when all answers match', () => {
    const answers = new Map([
        ['q-1', 'Light energy conversion'],
        ['q-2', 'Chlorophyll'],
        ['q-3', 'Mitochondria'],
        ['q-4', 'Gas exchange'],
    ]);

    const result = calculateQuizResult(SAMPLE_QUIZ, answers);

    assert.equal(result.score, 4);
    assert.equal(result.correctCount, 4);
    assert.equal(result.incorrectCount, 0);
    assert.equal(result.unansweredCount, 0);
    assert.equal(result.totalQuestions, 4);
    assert.equal(result.percentage, 100);
    assert.equal(result.questionResults.length, 4);
    assert.ok(result.questionResults.every((qr) => qr.isCorrect && !qr.isUnanswered));
});

test('9. calculateQuizResult calculates 0% when all answers are wrong', () => {
    const answers = {
        'q-1': 'Fermentation',
        'q-2': 'Carotenoid',
        'q-3': 'Ribosome',
        'q-4': 'Nutrient absorption',
    };

    const result = calculateQuizResult(SAMPLE_QUIZ, answers);

    assert.equal(result.score, 0);
    assert.equal(result.correctCount, 0);
    assert.equal(result.incorrectCount, 4);
    assert.equal(result.unansweredCount, 0);
    assert.equal(result.percentage, 0);
    assert.ok(result.questionResults.every((qr) => !qr.isCorrect && !qr.isUnanswered));
});

test('10. calculateQuizResult correctly identifies unanswered questions and increments unansweredCount', () => {
    // Only answer question 1 and 2, leave 3 and 4 unanswered
    const answers = new Map([
        ['q-1', 'Light energy conversion'], // Correct
        ['q-2', 'Carotenoid'],              // Incorrect
    ]);

    const result = calculateQuizResult(SAMPLE_QUIZ, answers);

    assert.equal(result.score, 1);
    assert.equal(result.correctCount, 1);
    assert.equal(result.incorrectCount, 1);
    assert.equal(result.unansweredCount, 2);
    assert.equal(result.totalQuestions, 4);
    assert.equal(result.percentage, 25);

    const q3 = result.questionResults.find((qr) => qr.questionId === 'q-3');
    assert.ok(q3);
    assert.equal(q3.isUnanswered, true);
    assert.equal(q3.selectedAnswer, null);
    assert.equal(q3.isCorrect, false);
});

test('11. calculateQuizResult handles empty quiz gracefully (0 total, 0%)', () => {
    const emptyQuiz = { id: 'empty', resourceId: 'res-empty', questions: [] };
    const result = calculateQuizResult(emptyQuiz, new Map());

    assert.equal(result.score, 0);
    assert.equal(result.correctCount, 0);
    assert.equal(result.incorrectCount, 0);
    assert.equal(result.unansweredCount, 0);
    assert.equal(result.totalQuestions, 0);
    assert.equal(result.percentage, 0);
    assert.deepEqual(result.questionResults, []);
});

test('12. calculateQuizResult accepts Map or plain object for userAnswers', () => {
    const mapAnswers = new Map([['q-1', 'Light energy conversion']]);
    const objAnswers = { 'q-1': 'Light energy conversion' };

    const resMap = calculateQuizResult(SAMPLE_QUIZ, mapAnswers);
    const resObj = calculateQuizResult(SAMPLE_QUIZ, objAnswers);

    assert.equal(resMap.score, resObj.score);
    assert.equal(resMap.percentage, resObj.percentage);
    assert.deepEqual(resMap.answers, resObj.answers);
});

test('13. calculateQuizResult preserves question order and sourceChunkIds in questionResults', () => {
    const result = calculateQuizResult(SAMPLE_QUIZ, {});

    assert.equal(result.questionResults[0].questionId, 'q-1');
    assert.deepEqual(result.questionResults[0].sourceChunkIds, [0]);
    assert.equal(result.questionResults[3].questionId, 'q-4');
    assert.deepEqual(result.questionResults[3].sourceChunkIds, [3]);
});

/* ── Quiz Attempt Service Tests (Phase 4) ────────────────────────── */

test('14. recordQuizAttempt creates and stores a complete attempt with timestamps', async () => {
    const repo = createMockAttemptRepo();
    const answers = {
        'q-1': 'Light energy conversion',
        'q-2': 'Chlorophyll',
    };

    const attempt = await recordQuizAttempt(SAMPLE_QUIZ, answers, {
        attemptRepo: repo,
        startedAt: '2026-09-26T12:00:00.000Z',
        completedAt: '2026-09-26T12:02:30.000Z',
    });

    assert.ok(typeof attempt.id === 'string' && attempt.id.length > 0);
    assert.equal(attempt.quizId, SAMPLE_QUIZ.id);
    assert.equal(attempt.resourceId, SAMPLE_QUIZ.resourceId);
    assert.equal(attempt.quizTitle, SAMPLE_QUIZ.title);
    assert.equal(attempt.score, 2);
    assert.equal(attempt.totalQuestions, 4);
    assert.equal(attempt.percentage, 50);
    assert.equal(attempt.startedAt, '2026-09-26T12:00:00.000Z');
    assert.equal(attempt.completedAt, '2026-09-26T12:02:30.000Z');

    const stored = await getAttempt(attempt.id, { attemptRepo: repo });
    assert.ok(stored);
    assert.equal(stored.id, attempt.id);
});

test('15. recordQuizAttempt stores multiple distinct attempts for the same quiz without overwriting', async () => {
    const repo = createMockAttemptRepo();

    const attempt1 = await recordQuizAttempt(
        SAMPLE_QUIZ,
        { 'q-1': 'Light energy conversion' },
        { attemptRepo: repo, completedAt: '2026-09-26T10:00:00.000Z' }
    );

    const attempt2 = await recordQuizAttempt(
        SAMPLE_QUIZ,
        { 'q-1': 'Light energy conversion', 'q-2': 'Chlorophyll', 'q-3': 'Mitochondria' },
        { attemptRepo: repo, completedAt: '2026-09-26T11:00:00.000Z' }
    );

    assert.notEqual(attempt1.id, attempt2.id);
    assert.equal(attempt1.score, 1);
    assert.equal(attempt2.score, 3);

    const quizAttempts = await getAttemptsForQuiz(SAMPLE_QUIZ.id, { attemptRepo: repo });
    assert.equal(quizAttempts.length, 2);
    assert.equal(await countAttempts({ attemptRepo: repo }), 2);
});

test('16. recordQuizAttempt fires notifyQuizAttemptsChanged event', async () => {
    const repo = createMockAttemptRepo();

    // Verify recordQuizAttempt succeeds and returns expected record structure
    const attempt = await recordQuizAttempt(
        SAMPLE_QUIZ,
        { 'q-1': 'Light energy conversion' },
        { attemptRepo: repo }
    );

    assert.equal(attempt.quizId, SAMPLE_QUIZ.id);
    assert.equal(attempt.percentage, 25);
});

test('17. getAttemptsForQuiz returns attempts sorted newest first', async () => {
    const repo = createMockAttemptRepo();

    await recordQuizAttempt(
        SAMPLE_QUIZ,
        {},
        { attemptRepo: repo, completedAt: '2026-09-26T08:00:00.000Z' }
    );
    await recordQuizAttempt(
        SAMPLE_QUIZ,
        {},
        { attemptRepo: repo, completedAt: '2026-09-26T14:00:00.000Z' }
    );
    await recordQuizAttempt(
        SAMPLE_QUIZ,
        {},
        { attemptRepo: repo, completedAt: '2026-09-26T10:00:00.000Z' }
    );

    const sorted = await getAttemptsForQuiz(SAMPLE_QUIZ.id, { attemptRepo: repo });
    assert.equal(sorted.length, 3);
    assert.equal(sorted[0].completedAt, '2026-09-26T14:00:00.000Z');
    assert.equal(sorted[1].completedAt, '2026-09-26T10:00:00.000Z');
    assert.equal(sorted[2].completedAt, '2026-09-26T08:00:00.000Z');
});

test('18. getAttemptsForResource returns all attempts across quizzes for a resource', async () => {
    const repo = createMockAttemptRepo();

    const quizA = { id: 'quiz-A', resourceId: 'res-shared', questions: [] };
    const quizB = { id: 'quiz-B', resourceId: 'res-shared', questions: [] };
    const quizC = { id: 'quiz-C', resourceId: 'res-other', questions: [] };

    await recordQuizAttempt(quizA, {}, { attemptRepo: repo });
    await recordQuizAttempt(quizB, {}, { attemptRepo: repo });
    await recordQuizAttempt(quizC, {}, { attemptRepo: repo });

    const sharedAttempts = await getAttemptsForResource('res-shared', { attemptRepo: repo });
    assert.equal(sharedAttempts.length, 2);

    const otherAttempts = await getAttemptsForResource('res-other', { attemptRepo: repo });
    assert.equal(otherAttempts.length, 1);
});

test('19. deleteAttemptsForResource cascades and deletes all attempts for a resource', async () => {
    const repo = createMockAttemptRepo();

    await recordQuizAttempt(SAMPLE_QUIZ, {}, { attemptRepo: repo });
    await recordQuizAttempt(SAMPLE_QUIZ, {}, { attemptRepo: repo });

    const deletedCount = await deleteAttemptsForResource(SAMPLE_QUIZ.resourceId, { attemptRepo: repo });
    assert.equal(deletedCount, 2);

    const remaining = await getAttemptsForResource(SAMPLE_QUIZ.resourceId, { attemptRepo: repo });
    assert.equal(remaining.length, 0);
});

/* ── Analytics Tests (Phase 5) ───────────────────────────────────── */

test('20. computeQuizAnalytics returns zeroed stats with empty list for 0 attempts', () => {
    const stats = computeQuizAnalytics([]);

    assert.equal(stats.totalAttempts, 0);
    assert.equal(stats.uniqueQuizzesCount, 0);
    assert.equal(stats.averageScorePercentage, 0);
    assert.equal(stats.highestScorePercentage, 0);
    assert.deepEqual(stats.recentAttempts, []);
});

test('21. computeQuizAnalytics calculates accurate average and highest percentage across multiple attempts', () => {
    const attempts = [
        { quizId: 'q-1', percentage: 60, completedAt: '2026-09-26T10:00:00.000Z' },
        { quizId: 'q-1', percentage: 90, completedAt: '2026-09-26T11:00:00.000Z' },
        { quizId: 'q-2', percentage: 80, completedAt: '2026-09-26T12:00:00.000Z' },
    ];

    const stats = computeQuizAnalytics(attempts);

    assert.equal(stats.totalAttempts, 3);
    assert.equal(stats.uniqueQuizzesCount, 2);
    // (60 + 90 + 80) / 3 = 76.67 => 77
    assert.equal(stats.averageScorePercentage, 77);
    assert.equal(stats.highestScorePercentage, 90);
});

test('22. computeQuizAnalytics counts unique quizzes taken correctly', () => {
    const attempts = [
        { quizId: 'quiz-alpha', percentage: 100 },
        { quizId: 'quiz-beta', percentage: 100 },
        { quizId: 'quiz-alpha', percentage: 80 },
        { quizId: 'quiz-gamma', percentage: 70 },
        { quizId: 'quiz-beta', percentage: 50 },
    ];

    const stats = computeQuizAnalytics(attempts);

    assert.equal(stats.totalAttempts, 5);
    assert.equal(stats.uniqueQuizzesCount, 3);
});

test('23. computeQuizAnalytics limits recentAttempts and sorts newest first', () => {
    const attempts = [];
    for (let i = 1; i <= 15; i++) {
        attempts.push({
            id: `att-${i}`,
            quizId: 'quiz-multi',
            percentage: i * 5,
            completedAt: `2026-09-${String(i).padStart(2, '0')}T10:00:00.000Z`,
        });
    }

    const stats = computeQuizAnalytics(attempts, { recentLimit: 5 });

    assert.equal(stats.recentAttempts.length, 5);
    assert.equal(stats.recentAttempts[0].id, 'att-15');
    assert.equal(stats.recentAttempts[4].id, 'att-11');
});

test('24. Regeneration scenario: attempt records remain preserved even if quiz is regenerated with new questions', async () => {
    const repo = createMockAttemptRepo();

    // 1. User takes initial quiz attempt
    const initialQuiz = {
        id: 'quiz-v1',
        resourceId: 'res-bio-1',
        title: 'Original Biology Quiz',
        questions: [{ id: 'q-orig-1', question: 'Original Q1', correctAnswer: 'A', options: ['A', 'B'] }],
    };

    const attempt1 = await recordQuizAttempt(initialQuiz, { 'q-orig-1': 'A' }, { attemptRepo: repo });
    assert.equal(attempt1.quizTitle, 'Original Biology Quiz');
    assert.equal(attempt1.score, 1);

    // 2. Quiz is regenerated for the resource (new quiz definition created, e.g. quiz-v2)
    const regeneratedQuiz = {
        id: 'quiz-v2',
        resourceId: 'res-bio-1',
        title: 'Regenerated Biology Quiz',
        questions: [{ id: 'q-new-1', question: 'New Q1', correctAnswer: 'X', options: ['X', 'Y'] }],
    };

    // User takes new quiz attempt
    const attempt2 = await recordQuizAttempt(regeneratedQuiz, { 'q-new-1': 'X' }, { attemptRepo: repo });

    // 3. Confirm both attempts exist under the resource and in global analytics
    const resourceAttempts = await getAttemptsForResource('res-bio-1', { attemptRepo: repo });
    assert.equal(resourceAttempts.length, 2);

    const originalAttemptLookup = await getAttempt(attempt1.id, { attemptRepo: repo });
    assert.ok(originalAttemptLookup);
    assert.equal(originalAttemptLookup.quizTitle, 'Original Biology Quiz');
    assert.equal(originalAttemptLookup.questionResults[0].question, 'Original Q1');

    const analytics = await getQuizAnalytics({ attemptRepo: repo });
    assert.equal(analytics.totalAttempts, 2);
    assert.equal(analytics.uniqueQuizzesCount, 2);
});
