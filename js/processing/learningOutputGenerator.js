/**
 * Deterministic Learning Output Generator — Day 10.
 *
 * Converts content analysis results into validated LearningOutput records
 * conforming to the Day 9 schema:
 * - summary (extractive)
 * - concept (key terms)
 * - definition (pattern-matched definitions)
 * - question (study questions grounded in concepts/definitions)
 *
 * Flashcards and quizzes are explicitly deferred to future milestones.
 * Every generated output strictly retains sourceChunkIds for source traceability.
 */

import { analyzeContent } from './contentAnalysis.js';
import {
    createLearningOutputRecord,
    generateLearningOutputId,
} from '../storage/learningOutputValidation.js';

export const DAY10_OUTPUT_TYPES = Object.freeze(['summary', 'concept', 'definition', 'question']);

/**
 * Generate LearningOutput records from processed content using deterministic analysis.
 *
 * @param {object} processedContent — ProcessedContent record with resourceId, normalizedText, chunks
 * @param {object} [options]
 * @param {Function} [options.idGenerator]
 * @param {Function} [options.clock]
 * @param {number} [options.maxConcepts=8]
 * @param {number} [options.maxQuestions=6]
 * @param {number} [options.maxSummarySentences=3]
 * @returns {Array<object>} list of validated LearningOutput records
 */
export function generateLearningOutputs(processedContent, options = {}) {
    if (!processedContent || typeof processedContent !== 'object') {
        throw new Error('Valid processed content is required to generate learning outputs.');
    }

    const resourceId = processedContent.resourceId;
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new Error('Processed content must have a valid resourceId.');
    }

    const idGenerator = options.idGenerator ?? generateLearningOutputId;
    const clock = options.clock ?? (() => new Date());

    const analysis = analyzeContent(processedContent, options);
    const outputs = [];

    // Helper to create & validate a record
    function addOutput(input) {
        const record = createLearningOutputRecord(input, { idGenerator, clock });
        outputs.push(record);
    }

    // 1. Extractive Summary
    if (analysis.summary && analysis.summary.text.trim().length > 0) {
        addOutput({
            resourceId,
            type: 'summary',
            content: analysis.summary.text,
            sourceChunkIds: analysis.summary.sourceChunkIds,
            metadata: {
                generator: 'deterministic-extractive',
                sentenceCount: analysis.summary.sentenceCount,
                analyzedAt: analysis.metadata.analyzedAt,
            },
        });
    }

    // 2. Key Concepts
    for (const concept of analysis.concepts) {
        addOutput({
            resourceId,
            type: 'concept',
            content: concept.term,
            sourceChunkIds: concept.sourceChunkIds,
            metadata: {
                term: concept.term,
                score: concept.score,
                generator: 'deterministic-frequency',
            },
        });
    }

    // 3. Definitions
    for (const def of analysis.definitions) {
        addOutput({
            resourceId,
            type: 'definition',
            content: `${def.term}: ${def.definition}`,
            sourceChunkIds: def.sourceChunkIds,
            metadata: {
                term: def.term,
                definition: def.definition,
                generator: 'deterministic-pattern',
            },
        });
    }

    // 4. Questions
    for (const q of analysis.questions) {
        addOutput({
            resourceId,
            type: 'question',
            content: q.question,
            sourceChunkIds: q.sourceChunkIds,
            metadata: {
                relatedTerm: q.term,
                generator: 'deterministic-pattern',
            },
        });
    }

    return outputs;
}
