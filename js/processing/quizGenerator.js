/**
 * Deterministic Quiz Generator — Day 13.
 *
 * Converts existing learning outputs (definitions, questions, key concepts) into
 * validated multiple-choice quiz questions (MCQs) without AI or hallucination.
 *
 * Generation principles:
 * - 1 correct option deterministically supported by source content
 * - Authentic distractors drawn from other terms/definitions within the same resource
 * - Deterministic option shuffling so correct answer positions vary
 * - Strict source chunk traceability (sourceChunkIds) on every question
 * - Validation to reject malformed or insufficient questions
 */

import {
    createQuizRecord,
    generateQuizId,
    validateQuizQuestion,
} from '../storage/quizValidation.js';
import { QuizValidationError } from '../storage/errors.js';

function stringHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * Deterministically shuffles an array based on an integer seed.
 * Ensures reproducible option ordering.
 */
function deterministicShuffle(array, seed) {
    const copy = [...array];
    let state = Math.abs(seed) || 1;

    for (let i = copy.length - 1; i > 0; i--) {
        state = (state * 1664525 + 1013904223) % 4294967296;
        const j = Math.floor((state / 4294967296) * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}

/**
 * Generates deterministic multiple-choice questions from learning outputs.
 *
 * @param {Array<object>} learningOutputs — LearningOutput records from storage
 * @param {object} resource — parent Resource record
 * @param {object} [options]
 * @param {Function} [options.idGenerator]
 * @param {Function} [options.clock]
 * @param {number} [options.maxQuestions=10]
 * @returns {object} validated Quiz record
 * @throws {QuizValidationError} if inputs are invalid or no valid questions can be generated
 */
export function generateQuiz(learningOutputs, resource, options = {}) {
    if (!resource || typeof resource.id !== 'string' || resource.id.trim() === '') {
        throw new QuizValidationError('A valid resource is required to generate a quiz.', {
            code: 'INVALID_RESOURCE',
        });
    }

    const resourceId = resource.id;
    const resourceTitle = resource.title?.trim() || 'StudyLens Resource';
    const idGenerator = options.idGenerator ?? generateQuizId;
    const clock = options.clock ?? (() => new Date());
    const maxQuestions = options.maxQuestions ?? 10;

    if (!Array.isArray(learningOutputs) || learningOutputs.length === 0) {
        throw new QuizValidationError('No learning outputs available to generate a quiz.', {
            code: 'NO_LEARNING_OUTPUTS',
        });
    }

    // Extract pools
    const definitions = learningOutputs.filter((o) => o.type === 'definition');
    const concepts = learningOutputs.filter((o) => o.type === 'concept');
    const questionsPool = learningOutputs.filter((o) => o.type === 'question');

    // Collect all unique terms and definitions for authentic distractors
    const allDefs = [];
    definitions.forEach((d) => {
        const term = d.metadata?.term;
        let defText = d.metadata?.definition;
        if (!defText && typeof d.content === 'string') {
            const colonIdx = d.content.indexOf(':');
            defText = colonIdx !== -1 ? d.content.slice(colonIdx + 1).trim() : d.content;
        }
        if (term && defText) {
            allDefs.push({
                term: term.trim(),
                definition: defText.trim(),
                sourceChunkIds: Array.isArray(d.sourceChunkIds) ? d.sourceChunkIds : [],
            });
        }
    });

    const allConceptTerms = [];
    concepts.forEach((c) => {
        const term = c.metadata?.term ?? (typeof c.content === 'string' ? c.content.trim() : '');
        if (term && !allConceptTerms.includes(term)) {
            allConceptTerms.push(term);
        }
    });

    const rawQuestions = [];
    const usedQuestionTexts = new Set();

    // Strategy 1: Definition -> Meaning MCQs
    // "What is the definition of {term}?" (Correct: definition, Distractors: other definitions)
    if (allDefs.length >= 2) {
        allDefs.forEach((target, idx) => {
            const questionText = `What is the definition of ${target.term}?`;
            if (usedQuestionTexts.has(questionText)) return;

            const correctAnswer = target.definition;
            // Distractors from other definitions
            const otherDefs = allDefs
                .filter((d) => d.term !== target.term && d.definition !== correctAnswer)
                .map((d) => d.definition);

            if (otherDefs.length >= 1) {
                const uniqueDistractors = [...new Set(otherDefs)].slice(0, 3);
                const unsharedOptions = [correctAnswer, ...uniqueDistractors];
                const shuffledOptions = deterministicShuffle(unsharedOptions, stringHash(questionText) + idx);

                rawQuestions.push({
                    id: `${resourceId}-q${rawQuestions.length}`,
                    question: questionText,
                    options: shuffledOptions,
                    correctAnswer,
                    sourceChunkIds: target.sourceChunkIds,
                    order: rawQuestions.length,
                });
                usedQuestionTexts.add(questionText);
            }
        });
    }

    // Strategy 2: Meaning -> Term MCQs
    // "Which term refers to: '{definition}'?" (Correct: term, Distractors: other terms + concepts)
    if (allDefs.length >= 1) {
        allDefs.forEach((target, idx) => {
            const truncatedDef = target.definition.length > 120
                ? target.definition.slice(0, 117) + '…'
                : target.definition;
            const questionText = `Which term refers to: "${truncatedDef}"?`;
            if (usedQuestionTexts.has(questionText)) return;

            const correctAnswer = target.term;
            // Distractors from other definition terms and concept terms
            const potentialDistractors = [
                ...allDefs.filter((d) => d.term !== target.term).map((d) => d.term),
                ...allConceptTerms.filter((c) => c !== target.term),
            ];

            const uniqueDistractors = [...new Set(potentialDistractors)]
                .filter((term) => term.toLowerCase() !== correctAnswer.toLowerCase())
                .slice(0, 3);

            if (uniqueDistractors.length >= 1) {
                const unsharedOptions = [correctAnswer, ...uniqueDistractors];
                const shuffledOptions = deterministicShuffle(unsharedOptions, stringHash(questionText) + idx + 100);

                rawQuestions.push({
                    id: `${resourceId}-q${rawQuestions.length}`,
                    question: questionText,
                    options: shuffledOptions,
                    correctAnswer,
                    sourceChunkIds: target.sourceChunkIds,
                    order: rawQuestions.length,
                });
                usedQuestionTexts.add(questionText);
            }
        });
    }

    // Strategy 3: Grounded Questions Pool Matching
    questionsPool.forEach((q, idx) => {
        const questionText = typeof q.content === 'string' ? q.content.trim() : '';
        const relatedTerm = q.metadata?.relatedTerm;
        if (!questionText || usedQuestionTexts.has(questionText) || !relatedTerm) return;

        const matchingDef = allDefs.find(
            (d) => d.term.toLowerCase() === relatedTerm.toLowerCase(),
        );

        if (matchingDef) {
            const correctAnswer = matchingDef.definition;
            const otherDefs = allDefs
                .filter((d) => d.definition !== correctAnswer)
                .map((d) => d.definition);

            if (otherDefs.length >= 1) {
                const uniqueDistractors = [...new Set(otherDefs)].slice(0, 3);
                const unsharedOptions = [correctAnswer, ...uniqueDistractors];
                const shuffledOptions = deterministicShuffle(unsharedOptions, stringHash(questionText) + idx + 200);

                rawQuestions.push({
                    id: `${resourceId}-q${rawQuestions.length}`,
                    question: questionText,
                    options: shuffledOptions,
                    correctAnswer,
                    sourceChunkIds: Array.isArray(q.sourceChunkIds) ? q.sourceChunkIds : matchingDef.sourceChunkIds,
                    order: rawQuestions.length,
                });
                usedQuestionTexts.add(questionText);
            }
        }
    });

    // Validate every generated question and filter out any malformed items
    const validQuestions = [];
    for (const raw of rawQuestions) {
        try {
            validateQuizQuestion(raw);
            validQuestions.push(raw);
            if (validQuestions.length >= maxQuestions) break;
        } catch {
            // Reject malformed questions
        }
    }

    if (validQuestions.length === 0) {
        throw new QuizValidationError('Could not generate any valid quiz questions from the provided content.', {
            code: 'NO_VALID_QUESTIONS',
        });
    }

    // Re-index order
    validQuestions.forEach((q, idx) => {
        q.order = idx;
    });

    const quizInput = {
        resourceId,
        title: `${resourceTitle} Quiz`,
        questions: validQuestions,
        metadata: {
            generator: 'deterministic-mcq',
            questionCount: validQuestions.length,
            generatedAt: new Date().toISOString(),
        },
    };

    return createQuizRecord(quizInput, { idGenerator, clock });
}
