/**
 * Flashcard Orchestration Service — Day 12.
 *
 * Coordinates flashcard generation, persistence, retrieval, and cleanup:
 * 1. Retrieves existing learning outputs for a resource.
 * 2. Generates flashcards from definitions, questions, and concepts.
 * 3. Removes previous flashcards to prevent duplicates on regeneration.
 * 4. Persists new flashcards via LearningOutputRepository (type: 'flashcard').
 * 5. Dispatches learning-output notification events.
 */

import { generateFlashcards } from '../processing/flashcardGenerator.js';
import { learningOutputRepository } from '../storage/learningOutputStore.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { notifyLearningOutputsChanged } from '../core/resourceEvents.js';
import {
    generateLearningOutputsForResource,
    getLearningOutputsSummaryForResource,
} from './learningOutputService.js';

/**
 * Generate, replace, and persist flashcards for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @param {object} [options.learningRepo]
 * @param {object} [options.resRepo]
 * @returns {Promise<{ resourceId: string, flashcards: Array<object>, count: number }>}
 */
export async function generateFlashcardsForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        throw new Error('A valid resourceId is required to generate flashcards.');
    }

    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const resRepo = options.resRepo ?? resourceRepository;

    // 1. Verify resource exists
    const resource = await resRepo.getResource(resourceId);
    if (!resource) {
        throw new Error('Resource not found: ' + resourceId);
    }

    // 2. Get existing learning outputs (generate if none exist)
    let allOutputs = await learningRepo.getLearningOutputsByResourceId(resourceId);
    const nonFlashcardOutputs = allOutputs.filter((o) => o.type !== 'flashcard');

    if (nonFlashcardOutputs.length === 0) {
        // Auto-generate learning outputs first
        await generateLearningOutputsForResource(resourceId, {
            resRepo,
            learningRepo,
            processedRepo: options.processedRepo,
        });
        allOutputs = await learningRepo.getLearningOutputsByResourceId(resourceId);
    }

    const sourceOutputs = allOutputs.filter((o) => o.type !== 'flashcard');

    if (sourceOutputs.length === 0) {
        throw new Error('No learning outputs available to generate flashcards from.');
    }

    // 3. Generate flashcards deterministically
    const generated = generateFlashcards(sourceOutputs, resourceId, options);

    if (generated.length === 0) {
        return { resourceId, flashcards: [], count: 0 };
    }

    // 4. Remove previous flashcards for this resource (regeneration safety)
    const existingFlashcards = allOutputs.filter((o) => o.type === 'flashcard');
    for (const old of existingFlashcards) {
        await learningRepo.deleteLearningOutput(old.id);
    }

    // 5. Persist new flashcards
    const savedFlashcards = [];
    for (const card of generated) {
        const saved = await learningRepo.createLearningOutput(card);
        savedFlashcards.push(saved);
    }

    // 6. Notify UI/listeners
    notifyLearningOutputsChanged({
        action: 'flashcards-generated',
        resourceId,
        count: savedFlashcards.length,
    });

    return {
        resourceId,
        flashcards: savedFlashcards,
        count: savedFlashcards.length,
    };
}

/**
 * Retrieve all flashcards for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getFlashcardsForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return [];
    }

    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const allOutputs = await learningRepo.getLearningOutputsByResourceId(resourceId);
    return allOutputs.filter((o) => o.type === 'flashcard');
}

/**
 * Get all flashcard decks grouped by resource.
 * Each deck includes the resource title, resource ID, and flashcard list.
 *
 * @param {object} [options]
 * @returns {Promise<Array<{ resourceId: string, title: string, flashcards: Array<object>, count: number }>>}
 */
export async function getFlashcardDecks(options = {}) {
    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const resRepo = options.resRepo ?? resourceRepository;

    const allFlashcards = await learningRepo.getLearningOutputsByType('flashcard');

    if (allFlashcards.length === 0) {
        return [];
    }

    // Group by resourceId
    const grouped = new Map();
    for (const card of allFlashcards) {
        if (!grouped.has(card.resourceId)) {
            grouped.set(card.resourceId, []);
        }
        grouped.get(card.resourceId).push(card);
    }

    // Build deck objects with resource titles
    const decks = [];
    for (const [resourceId, flashcards] of grouped) {
        let title = 'Untitled Resource';
        try {
            const resource = await resRepo.getResource(resourceId);
            if (resource) title = resource.title;
        } catch {
            // Use fallback title
        }

        decks.push({
            resourceId,
            title,
            flashcards,
            count: flashcards.length,
        });
    }

    // Sort by most recently created flashcard
    decks.sort((a, b) => {
        const aLatest = Math.max(...a.flashcards.map((c) => Date.parse(c.createdAt)));
        const bLatest = Math.max(...b.flashcards.map((c) => Date.parse(c.createdAt)));
        return bLatest - aLatest;
    });

    return decks;
}

/**
 * Delete all flashcards for a specific resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<number>} count of deleted flashcards
 */
export async function deleteFlashcardsForResource(resourceId, options = {}) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
        return 0;
    }

    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const flashcards = await getFlashcardsForResource(resourceId, { learningRepo });

    let count = 0;
    for (const card of flashcards) {
        await learningRepo.deleteLearningOutput(card.id);
        count++;
    }

    if (count > 0) {
        notifyLearningOutputsChanged({
            action: 'flashcards-deleted',
            resourceId,
            count,
        });
    }

    return count;
}

/**
 * Get total flashcard count across all resources.
 *
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function getFlashcardCount(options = {}) {
    const learningRepo = options.learningRepo ?? learningOutputRepository;
    const allFlashcards = await learningRepo.getLearningOutputsByType('flashcard');
    return allFlashcards.length;
}
