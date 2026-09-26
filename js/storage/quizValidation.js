import { QuizValidationError } from './errors.js';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isValidIsoTimestamp(value) {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && !Number.isNaN(Date.parse(value));
}

function createTimestamp(clock) {
    const value = clock();
    return value instanceof Date ? value.toISOString() : value;
}

export function generateQuizId() {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new QuizValidationError('This browser cannot generate secure quiz IDs.', {
            code: 'UUID_UNAVAILABLE',
        });
    }

    return globalThis.crypto.randomUUID();
}

/**
 * Validates a single Quiz Question against schema requirements.
 *
 * @param {object} question
 * @returns {object} validated question
 * @throws {QuizValidationError} if invalid
 */
export function validateQuizQuestion(question) {
    if (!isPlainObject(question)) {
        throw new QuizValidationError('A quiz question must be an object.');
    }

    const problems = [];

    if (typeof question.id !== 'string' || question.id.trim() === '') {
        problems.push('question id must be a non-empty string');
    }

    if (typeof question.question !== 'string' || question.question.trim() === '') {
        problems.push('question text must be a non-empty string');
    }

    if (!Array.isArray(question.options) || question.options.length < 2) {
        problems.push('options must be an array with at least 2 choices');
    } else {
        const hasInvalidOption = question.options.some(
            (opt) => typeof opt !== 'string' || opt.trim() === '',
        );
        if (hasInvalidOption) {
            problems.push('all options must be non-empty strings');
        }

        // Check for duplicates
        const uniqueOptions = new Set(question.options.map((opt) => opt.trim()));
        if (uniqueOptions.size !== question.options.length) {
            problems.push('options cannot contain duplicate choices');
        }
    }

    if (typeof question.correctAnswer !== 'string' || question.correctAnswer.trim() === '') {
        problems.push('correctAnswer must be a non-empty string');
    } else if (Array.isArray(question.options) && !question.options.includes(question.correctAnswer)) {
        problems.push('correctAnswer must be one of the provided options');
    }

    if (!Array.isArray(question.sourceChunkIds)) {
        problems.push('sourceChunkIds must be an array');
    } else {
        const hasInvalidChunkId = question.sourceChunkIds.some((chunkId) => {
            if (typeof chunkId === 'number') {
                return !Number.isInteger(chunkId) || chunkId < 0;
            }
            if (typeof chunkId === 'string') {
                return chunkId.trim() === '';
            }
            return true;
        });
        if (hasInvalidChunkId) {
            problems.push('sourceChunkIds elements must be non-negative integers or non-empty strings');
        }
    }

    if (typeof question.order !== 'number' || !Number.isInteger(question.order) || question.order < 0) {
        problems.push('order must be a non-negative integer');
    }

    if (problems.length > 0) {
        throw new QuizValidationError('Invalid quiz question: ' + problems.join('; ') + '.');
    }

    return question;
}

/**
 * Validates a complete Quiz record against schema requirements.
 *
 * @param {object} quiz
 * @returns {object} validated quiz
 * @throws {QuizValidationError} if invalid
 */
export function validateQuiz(quiz) {
    if (!isPlainObject(quiz)) {
        throw new QuizValidationError('A quiz must be an object.');
    }

    const problems = [];

    if (typeof quiz.id !== 'string' || quiz.id.trim() === '') {
        problems.push('id must be a non-empty string');
    }

    if (typeof quiz.resourceId !== 'string' || quiz.resourceId.trim() === '') {
        problems.push('resourceId must be a non-empty string');
    }

    if (typeof quiz.title !== 'string' || quiz.title.trim() === '') {
        problems.push('title must be a non-empty string');
    }

    if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
        problems.push('questions must be a non-empty array of questions');
    } else {
        quiz.questions.forEach((q, idx) => {
            try {
                validateQuizQuestion(q);
            } catch (err) {
                problems.push(`question at index ${idx} is invalid (${err.message})`);
            }
        });
    }

    if (!isPlainObject(quiz.metadata)) {
        problems.push('metadata must be an object');
    }

    if (!isValidIsoTimestamp(quiz.createdAt)) {
        problems.push('createdAt must be an ISO timestamp');
    }

    if (!isValidIsoTimestamp(quiz.updatedAt)) {
        problems.push('updatedAt must be an ISO timestamp');
    }

    if (isValidIsoTimestamp(quiz.createdAt) && isValidIsoTimestamp(quiz.updatedAt)
        && Date.parse(quiz.updatedAt) < Date.parse(quiz.createdAt)) {
        problems.push('updatedAt cannot be earlier than createdAt');
    }

    if (problems.length > 0) {
        throw new QuizValidationError('Invalid quiz: ' + problems.join('; ') + '.');
    }

    return quiz;
}

/**
 * Creates and validates a new Quiz record.
 */
export function createQuizRecord(input, {
    idGenerator = generateQuizId,
    clock = () => new Date(),
} = {}) {
    if (!isPlainObject(input)) {
        throw new QuizValidationError('Quiz input must be an object.');
    }

    const timestamp = createTimestamp(clock);

    const questions = Array.isArray(input.questions)
        ? input.questions.map((q, idx) => ({
            id: q.id || `${idGenerator()}-q${idx}`,
            question: typeof q.question === 'string' ? q.question.trim() : q.question,
            options: Array.isArray(q.options) ? q.options.map((opt) => (typeof opt === 'string' ? opt.trim() : opt)) : q.options,
            correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : q.correctAnswer,
            sourceChunkIds: Array.isArray(q.sourceChunkIds) ? [...q.sourceChunkIds] : [],
            order: typeof q.order === 'number' ? q.order : idx,
        }))
        : input.questions;

    const record = {
        id: idGenerator(),
        resourceId: typeof input.resourceId === 'string' ? input.resourceId.trim() : input.resourceId,
        title: typeof input.title === 'string' ? input.title.trim() : input.title,
        questions,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    return validateQuiz(record);
}

/**
 * Creates an updated Quiz record, enforcing immutability of id, resourceId, and createdAt.
 */
export function createUpdatedQuiz(existingRecord, updates, {
    clock = () => new Date(),
} = {}) {
    validateQuiz(existingRecord);

    if (!isPlainObject(updates)) {
        throw new QuizValidationError('Quiz updates must be an object.');
    }

    if (Object.hasOwn(updates, 'id') || Object.hasOwn(updates, 'resourceId') || Object.hasOwn(updates, 'createdAt')) {
        throw new QuizValidationError('Quiz id, resourceId, and createdAt cannot be changed.', {
            code: 'IMMUTABLE_QUIZ_FIELD',
        });
    }

    const allowedFields = ['title', 'questions', 'metadata'];
    const allowedUpdates = {};

    allowedFields.forEach((field) => {
        if (Object.hasOwn(updates, field)) allowedUpdates[field] = updates[field];
    });

    const updated = {
        ...existingRecord,
        ...allowedUpdates,
        updatedAt: createTimestamp(clock),
    };

    return validateQuiz(updated);
}
