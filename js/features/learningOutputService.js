/**
 * Learning Output Orchestration Service — Day 10.
 *
 * Coordinates deterministic learning output generation for a resource:
 * 1. Retrieves processed content (or processes resource if missing).
 * 2. Generates outputs (summary, concepts, definitions, questions) with source traceability.
 * 3. Removes previous generated outputs to prevent duplicates upon regeneration.
 * 4. Persists new outputs to IndexedDB using LearningOutputRepository.
 * 5. Dispatches learning-output notification events.
 */

import { generateLearningOutputs, DAY10_OUTPUT_TYPES } from '../processing/learningOutputGenerator.js';
import { getProcessedContent, processAndStore } from './processingIntegration.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { learningOutputRepository } from '../storage/learningOutputStore.js';
import { notifyLearningOutputsChanged } from '../core/resourceEvents.js';

/**
 * Generate, replace, and persist learning outputs for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @param {object} [options.resRepo]
 * @param {object} [options.processedRepo]
 * @param {object} [options.learningRepo]
 * @param {Function} [options.clock]
 * @returns {Promise<{ resourceId: string, outputs: Array<object>, counts: object }>}
 */
export async function generateLearningOutputsForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new Error('A valid resourceId is required to generate learning outputs.');
    }

    const resRepo = options.resRepo ?? resourceRepository;
    const processedRepo = options.processedRepo;
    const learningRepo = options.learningRepo ?? learningOutputRepository;

    // 1. Verify resource exists
    const resource = await resRepo.getResource(resourceId);
    if (!resource) {
        throw new Error('Resource not found: ' + resourceId);
    }

    // 2. Retrieve processed content (or process if needed)
    let processedContent = await getProcessedContent(resourceId, processedRepo);

    if (!processedContent && resource.content && resource.content.trim().length > 0) {
        try {
            processedContent = await processAndStore(resource, { resRepo, processedRepo });
        } catch (procErr) {
            console.warn('StudyLens could not auto-process resource before output generation.', procErr);
        }
    }

    if (!processedContent) {
        throw new Error('No processed content is available for resource: ' + resourceId);
    }

    const text = processedContent.normalizedText ?? processedContent.text ?? '';
    if (typeof text !== 'string' || text.trim() === '') {
        throw new Error('Cannot generate learning outputs for empty content.');
    }

    // 3. Generate deterministic outputs with source traceability
    const generated = generateLearningOutputs(processedContent, options);

    // 4. Remove previous outputs for this resource to ensure clean regeneration
    await learningRepo.deleteLearningOutputsByResourceId(resourceId);

    // 5. Persist new outputs
    const savedOutputs = [];
    for (const item of generated) {
        const saved = await learningRepo.createLearningOutput(item);
        savedOutputs.push(saved);
    }

    // 6. Notify UI/listeners
    notifyLearningOutputsChanged({
        action: 'generated',
        resourceId,
        count: savedOutputs.length,
    });

    const counts = {
        summary: savedOutputs.filter((o) => o.type === 'summary').length,
        concept: savedOutputs.filter((o) => o.type === 'concept').length,
        definition: savedOutputs.filter((o) => o.type === 'definition').length,
        question: savedOutputs.filter((o) => o.type === 'question').length,
        total: savedOutputs.length,
    };

    return {
        resourceId,
        outputs: savedOutputs,
        counts,
    };
}

/**
 * Get summary counts and list of learning outputs for a resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<{ hasOutputs: boolean, total: number, counts: object, outputs: Array<object> }>}
 */
export async function getLearningOutputsSummaryForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return {
            hasOutputs: false,
            total: 0,
            counts: { summary: 0, concept: 0, definition: 0, question: 0, flashcard: 0 },
            outputs: [],
        };
    }

    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const outputs = await learningRepo.getLearningOutputsByResourceId(resourceId);

    const counts = {
        summary: outputs.filter((o) => o.type === 'summary').length,
        concept: outputs.filter((o) => o.type === 'concept').length,
        definition: outputs.filter((o) => o.type === 'definition').length,
        question: outputs.filter((o) => o.type === 'question').length,
        flashcard: outputs.filter((o) => o.type === 'flashcard').length,
    };

    return {
        hasOutputs: outputs.length > 0,
        total: outputs.length,
        counts,
        outputs,
    };
}

/**
 * Clear all learning outputs for a resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function clearLearningOutputsForResource(resourceId, options = {}) {
    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const count = await learningRepo.deleteLearningOutputsByResourceId(resourceId);

    notifyLearningOutputsChanged({
        action: 'cleared',
        resourceId,
        count,
    });

    return count;
}
