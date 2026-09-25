/**
 * Deterministic Flashcard Generator — Day 12.
 *
 * Converts existing learning outputs (definitions, questions, concepts) into
 * flashcard records with structured { front, back } content.
 *
 * Generation rules (no fabrication):
 * - Definitions → front: term, back: definition text
 * - Questions → front: question, back: "Review concept: {relatedTerm}"
 * - Concepts → front: "What is {concept}?", back: "Key concept identified in this resource."
 *
 * Every generated flashcard retains sourceChunkIds from the source output.
 * The generator interface is kept clean for future AI replacement.
 */

import {
    createLearningOutputRecord,
    generateLearningOutputId,
} from '../storage/learningOutputValidation.js';

/**
 * Generate flashcard records from existing learning outputs.
 *
 * @param {Array<object>} learningOutputs — validated LearningOutput records
 * @param {string} resourceId
 * @param {object} [options]
 * @param {Function} [options.idGenerator]
 * @param {Function} [options.clock]
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

        if (term && definition) {
            addFlashcard(
                term,
                definition,
                def.sourceChunkIds,
                { sourceType: 'definition', sourceOutputId: def.id },
            );
        }
    }

    // 2. Questions → Flashcards (question on front, related term hint on back)
    const questions = learningOutputs.filter((o) => o.type === 'question');
    for (const q of questions) {
        const question = typeof q.content === 'string' ? q.content.trim() : '';
        const relatedTerm = q.metadata?.relatedTerm ?? '';

        if (question) {
            const back = relatedTerm
                ? `Review concept: ${relatedTerm}`
                : 'Review the source material for this question.';
            addFlashcard(
                question,
                back,
                q.sourceChunkIds,
                { sourceType: 'question', sourceOutputId: q.id },
            );
        }
    }

    // 3. Concepts → Flashcards (concept recall prompt)
    const concepts = learningOutputs.filter((o) => o.type === 'concept');
    for (const concept of concepts) {
        const term = concept.metadata?.term ?? (typeof concept.content === 'string' ? concept.content.trim() : '');

        if (term) {
            addFlashcard(
                `What is ${term}?`,
                'Key concept identified in this resource.',
                concept.sourceChunkIds,
                { sourceType: 'concept', sourceOutputId: concept.id },
            );
        }
    }

    return flashcards;
}
