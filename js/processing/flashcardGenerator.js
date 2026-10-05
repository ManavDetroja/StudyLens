/**
 * Deterministic Flashcard Generator — Day 12 & Day 19.
 *
 * Converts existing learning outputs (definitions, questions, concepts) into
 * flashcard records with structured { front, back } content.
 *
 * Generation rules (grounded, no fabrication):
 * - Definitions → front: term, back: source definition text
 * - Questions → front: question, back: grounded answer from source evidence
 * - Concepts → front: "What is {concept}?", back: grounded explanation from source evidence
 *
 * Fallback to referral hints is preserved only for legacy fixtures when strictQuality is disabled.
 * Every generated flashcard retains sourceChunkIds from the source output.
 */

import {
    createLearningOutputRecord,
    generateLearningOutputId,
} from '../storage/learningOutputValidation.js';
import {
    isGenericPlaceholder,
    validateLearningAnswer,
} from './evidenceRetrieval.js';

/**
 * Generate flashcard records from existing learning outputs.
 *
 * @param {Array<object>} learningOutputs — validated LearningOutput records
 * @param {string} resourceId
 * @param {object} [options]
 * @param {Function} [options.idGenerator]
 * @param {Function} [options.clock]
 * @param {boolean} [options.strictQuality=false]
 * @returns {Array<object>} validated flashcard LearningOutput records
 */
export function generateFlashcards(learningOutputs, resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new Error('A valid resourceId is required to generate flashcards.');
    }

    if (!Array.isArray(learningOutputs) || learningOutputs.length === 0) {
        return [];
    }

    const idGenerator = options.idGenerator ?? generateLearningOutputId;
    const clock = options.clock ?? (() => new Date());
    const strictQuality = options.strictQuality ?? false;

    const flashcards = [];

    // Helper to create a validated flashcard record
    function addFlashcard(front, back, sourceChunkIds, metadata) {
        const record = createLearningOutputRecord({
            resourceId,
            type: 'flashcard',
            content: { front, back },
            sourceChunkIds: sourceChunkIds ?? [],
            metadata: {
                ...metadata,
                generator: 'deterministic',
            },
        }, { idGenerator, clock });
        flashcards.push(record);
    }

    // 1. Definitions → Flashcards (highest quality — real term + real definition)
    const definitions = learningOutputs.filter((o) => o.type === 'definition');
    for (const def of definitions) {
        const term = def.metadata?.term;
        const definition = def.metadata?.definition;

        if (term && definition && !isGenericPlaceholder(definition)) {
            addFlashcard(
                term,
                definition,
                def.sourceChunkIds,
                { sourceType: 'definition', sourceOutputId: def.id, grounded: true },
            );
        }
    }

    // 2. Questions → Flashcards (grounded answer on back)
    const questions = learningOutputs.filter((o) => o.type === 'question');
    for (const q of questions) {
        const question = typeof q.content === 'string' ? q.content.trim() : '';
        const answer = q.metadata?.answer?.trim();
        const relatedTerm = q.metadata?.relatedTerm ?? '';

        if (question) {
            if (answer && validateLearningAnswer(answer)) {
                addFlashcard(
                    question,
                    answer,
                    q.sourceChunkIds,
                    { sourceType: 'question', sourceOutputId: q.id, grounded: true },
                );
            } else if (!strictQuality) {
                const back = relatedTerm
                    ? `Review concept: ${relatedTerm}`
                    : 'Review the source material for this question.';
                addFlashcard(
                    question,
                    back,
                    q.sourceChunkIds,
                    { sourceType: 'question', sourceOutputId: q.id, grounded: false },
                );
            }
        }
    }

    // 3. Concepts → Flashcards (grounded explanation on back)
    const concepts = learningOutputs.filter((o) => o.type === 'concept');
    for (const concept of concepts) {
        const term = concept.metadata?.term ?? (typeof concept.content === 'string' ? concept.content.trim() : '');
        const explanation = concept.metadata?.explanation?.trim();

        if (term) {
            if (explanation && validateLearningAnswer(explanation)) {
                addFlashcard(
                    `What is ${term}?`,
                    explanation,
                    concept.sourceChunkIds,
                    { sourceType: 'concept', sourceOutputId: concept.id, grounded: true },
                );
            } else if (!strictQuality) {
                addFlashcard(
                    `What is ${term}?`,
                    'Key concept identified in this resource.',
                    concept.sourceChunkIds,
                    { sourceType: 'concept', sourceOutputId: concept.id, grounded: false },
                );
            }
        }
    }

    return flashcards;
}
