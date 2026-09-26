import { QuizAttemptValidationError } from './errors.js';

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

export function generateQuizAttemptId() {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new QuizAttemptValidationError('This browser cannot generate secure quiz attempt IDs.', {
            code: 'UUID_UNAVAILABLE',
        });
    }

    return globalThis.crypto.randomUUID();
}

/**
 * Validates a single question result entry in an attempt.
 *
 * @param {object} item
 * @returns {object} validated item
 */
export function validateQuestionResult(item) {
    if (!isPlainObject(item)) {
        throw new QuizAttemptValidationError('Each question result must be an object.');
    }

    const problems = [];

    if (typeof item.questionId !== 'string' || item.questionId.trim() === '') {
        problems.push('questionId must be a non-empty string');
    }

    if (typeof item.question !== 'string' || item.question.trim() === '') {
        problems.push('question text must be a non-empty string');
    }

    if (item.selectedAnswer !== null && typeof item.selectedAnswer !== 'string') {
        problems.push('selectedAnswer must be a string or null');
    }

    if (typeof item.correctAnswer !== 'string' || item.correctAnswer.trim() === '') {
        problems.push('correctAnswer must be a non-empty string');
    }

    if (typeof item.isCorrect !== 'boolean') {
        problems.push('isCorrect must be a boolean');
    }

    if (typeof item.isUnanswered !== 'boolean') {
        problems.push('isUnanswered must be a boolean');
    }

    if (!Array.isArray(item.sourceChunkIds)) {
        problems.push('sourceChunkIds must be an array');
    }

    if (problems.length > 0) {
        throw new QuizAttemptValidationError('Invalid question result: ' + problems.join('; ') + '.');
    }

    return item;
}

/**
 * Validates a complete Quiz Attempt record against schema requirements.
 *
 * @param {object} attempt
 * @returns {object} validated attempt
 * @throws {QuizAttemptValidationError} if invalid
 */
export function validateQuizAttempt(attempt) {
    if (!isPlainObject(attempt)) {
        throw new QuizAttemptValidationError('A quiz attempt must be an object.');
    }

    const problems = [];

    if (typeof attempt.id !== 'string' || attempt.id.trim() === '') {
        problems.push('id must be a non-empty string');
    }

    if (typeof attempt.quizId !== 'string' || attempt.quizId.trim() === '') {
        problems.push('quizId must be a non-empty string');
    }

    if (typeof attempt.resourceId !== 'string' || attempt.resourceId.trim() === '') {
        problems.push('resourceId must be a non-empty string');
    }

    if (typeof attempt.quizTitle !== 'string' || attempt.quizTitle.trim() === '') {
        problems.push('quizTitle must be a non-empty string');
    }

    if (typeof attempt.score !== 'number' || !Number.isInteger(attempt.score) || attempt.score < 0) {
        problems.push('score must be a non-negative integer');
    }

    if (typeof attempt.correctCount !== 'number' || !Number.isInteger(attempt.correctCount) || attempt.correctCount < 0) {
        problems.push('correctCount must be a non-negative integer');
    }

    if (typeof attempt.incorrectCount !== 'number' || !Number.isInteger(attempt.incorrectCount) || attempt.incorrectCount < 0) {
        problems.push('incorrectCount must be a non-negative integer');
    }

    if (typeof attempt.unansweredCount !== 'number' || !Number.isInteger(attempt.unansweredCount) || attempt.unansweredCount < 0) {
        problems.push('unansweredCount must be a non-negative integer');
    }

    if (typeof attempt.totalQuestions !== 'number' || !Number.isInteger(attempt.totalQuestions) || attempt.totalQuestions < 0) {
        problems.push('totalQuestions must be a non-negative integer');
    }

    if (typeof attempt.percentage !== 'number' || attempt.percentage < 0 || attempt.percentage > 100) {
        problems.push('percentage must be a number between 0 and 100');
    }

    if (!isPlainObject(attempt.answers)) {
        problems.push('answers must be an object');
    }

    if (!Array.isArray(attempt.questionResults)) {
        problems.push('questionResults must be an array');
    } else {
        attempt.questionResults.forEach((qr, idx) => {
            try {
                validateQuestionResult(qr);
            } catch (err) {
                problems.push(`questionResult at index ${idx} is invalid (${err.message})`);
            }
        });
    }

    if (!isValidIsoTimestamp(attempt.startedAt)) {
        problems.push('startedAt must be an ISO timestamp');
    }

    if (!isValidIsoTimestamp(attempt.completedAt)) {
        problems.push('completedAt must be an ISO timestamp');
    }

    if (!isValidIsoTimestamp(attempt.createdAt)) {
        problems.push('createdAt must be an ISO timestamp');
    }

    if (!isPlainObject(attempt.metadata ?? {})) {
        problems.push('metadata must be an object');
    }

    if (problems.length > 0) {
        throw new QuizAttemptValidationError('Invalid quiz attempt: ' + problems.join('; ') + '.');
    }

    return attempt;
}

/**
 * Creates a validated Quiz Attempt record from input values.
 *
 * @param {object} input
 * @param {object} [options]
 * @param {Function} [options.idGenerator]
 * @param {Function} [options.clock]
 * @returns {object} validated QuizAttempt record
 */
export function createQuizAttemptRecord(input, {
    idGenerator = generateQuizAttemptId,
    clock = () => new Date(),
} = {}) {
    if (!isPlainObject(input)) {
        throw new QuizAttemptValidationError('Quiz attempt input must be an object.');
    }

    const timestamp = createTimestamp(clock);

    const record = {
        id: idGenerator(),
        quizId: typeof input.quizId === 'string' ? input.quizId.trim() : input.quizId,
        resourceId: typeof input.resourceId === 'string' ? input.resourceId.trim() : input.resourceId,
        quizTitle: typeof input.quizTitle === 'string' ? input.quizTitle.trim() : input.quizTitle,
        score: input.score ?? 0,
        correctCount: input.correctCount ?? 0,
        incorrectCount: input.incorrectCount ?? 0,
        unansweredCount: input.unansweredCount ?? 0,
        totalQuestions: input.totalQuestions ?? 0,
        percentage: input.percentage ?? 0,
        answers: isPlainObject(input.answers) ? { ...input.answers } : input.answers,
        questionResults: Array.isArray(input.questionResults)
            ? input.questionResults.map((qr) => ({
                questionId: qr.questionId,
                question: qr.question,
                selectedAnswer: qr.selectedAnswer ?? null,
                correctAnswer: qr.correctAnswer,
                isCorrect: Boolean(qr.isCorrect),
                isUnanswered: Boolean(qr.isUnanswered),
                sourceChunkIds: Array.isArray(qr.sourceChunkIds) ? [...qr.sourceChunkIds] : [],
            }))
            : input.questionResults,
        startedAt: input.startedAt ?? timestamp,
        completedAt: input.completedAt ?? timestamp,
        createdAt: timestamp,
        metadata: input.metadata ?? {},
    };

    return validateQuizAttempt(record);
}
