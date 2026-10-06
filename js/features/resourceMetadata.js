/**
 * Resource Metadata and Capabilities Service — Day 23.
 *
 * Provides pure visual presentation helpers (type icons, tones, source formatting)
 * and durable count aggregations from IndexedDB repositories for the Resource
 * Management Workspace.
 */

import { learningOutputRepository } from '../storage/learningOutputStore.js';
import { quizRepository } from '../storage/quizStore.js';
import { quizAttemptRepository } from '../storage/quizAttemptStore.js';
import { noteRepository } from '../storage/noteStore.js';
import { processedContentRepository } from '../storage/processedContentStore.js';
import { formatFileSize } from './fileImportConfig.js';

/**
 * Return visual presentation attributes for a resource type.
 * Ensures consistent multi-sensory presentation (icon + label + tone) across StudyLens.
 *
 * @param {string} type - 'video' | 'pdf' | 'image' | 'text'
 * @returns {{ label: string, toneClass: string, iconSvg: string }}
 */
export function getResourceTypePresentation(type) {
    switch (type) {
        case 'video':
            return {
                label: 'Video',
                toneClass: 'tone-violet',
                iconSvg: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></svg>',
            };
        case 'pdf':
            return {
                label: 'PDF',
                toneClass: 'tone-rose',
                iconSvg: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M8 14h8M8 18h5"/></svg>',
            };
        case 'image':
            return {
                label: 'Image',
                toneClass: 'tone-amber',
                iconSvg: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>',
            };
        case 'text':
        default:
            return {
                label: 'Text',
                toneClass: 'tone-blue',
                iconSvg: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 13h8M8 17h8"/></svg>',
            };
    }
}

/**
 * Build a concise, human-readable file or source summary string.
 *
 * @param {object} resource
 * @returns {string}
 */
export function formatFileOrSourceSummary(resource) {
    if (!resource) return '';

    if (resource.type === 'pdf' || resource.type === 'image') {
        const originalName = resource.metadata?.originalFileName || '';
        const size = Number(resource.metadata?.fileSize) || 0;
        const sizeStr = size > 0 ? ` (${formatFileSize(size)})` : '';
        if (originalName) {
            return `${originalName}${sizeStr}`;
        }
        return resource.type === 'pdf' ? `PDF Document${sizeStr}` : `Image File${sizeStr}`;
    }

    if (resource.type === 'video') {
        const videoId = resource.metadata?.videoId;
        if (videoId) {
            return `YouTube · ${videoId}`;
        }
        if (typeof resource.source === 'string' && resource.source.includes('youtube.com')) {
            return 'YouTube Video';
        }
        return 'Video';
    }

    if (resource.type === 'text') {
        return 'Manual text';
    }

    return resource.source || '';
}

/**
 * Format a resource date relative to its creation and update times.
 *
 * @param {string} createdAt
 * @param {string} [updatedAt]
 * @returns {string}
 */
export function formatResourceDateContext(createdAt, updatedAt) {
    const createdMs = Date.parse(createdAt);
    const updatedMs = Date.parse(updatedAt);

    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

    if (!Number.isNaN(updatedMs) && !Number.isNaN(createdMs) && (updatedMs - createdMs > 60_000)) {
        return 'Updated ' + formatter.format(new Date(updatedMs));
    }

    if (!Number.isNaN(createdMs)) {
        return 'Created ' + formatter.format(new Date(createdMs));
    }

    return 'Unknown date';
}

/**
 * Retrieve learning material capability counts for a single resource.
 *
 * @param {string} resourceId
 * @returns {Promise<{
 *   learningOutputsCount: number,
 *   flashcardsCount: number,
 *   quizzesCount: number,
 *   attemptsCount: number,
 *   notesCount: number,
 *   chunksCount: number,
 *   hasProcessedContent: boolean
 * }>}
 */
export async function getResourceCounts(resourceId) {
    if (typeof resourceId !== 'string' || !resourceId.trim()) {
        return {
            learningOutputsCount: 0,
            flashcardsCount: 0,
            quizzesCount: 0,
            attemptsCount: 0,
            notesCount: 0,
            chunksCount: 0,
            hasProcessedContent: false,
        };
    }

    const [outputs, quizzes, attempts, notes, processed] = await Promise.all([
        learningOutputRepository.getLearningOutputsByResourceId(resourceId).catch(() => []),
        quizRepository.getQuizzesByResourceId(resourceId).catch(() => []),
        quizAttemptRepository.getAttemptsByResource(resourceId).catch(() => []),
        noteRepository.getNotesByResource(resourceId).catch(() => []),
        processedContentRepository.getByResourceId(resourceId).catch(() => null),
    ]);

    const flashcardsCount = outputs.filter((o) => o.type === 'flashcard').length;
    const learningOutputsCount = outputs.filter((o) => o.type !== 'flashcard' && o.type !== 'quiz').length;
    const quizzesCount = Array.isArray(quizzes) ? quizzes.length : (quizzes ? 1 : 0);
    const attemptsCount = Array.isArray(attempts) ? attempts.length : 0;
    const notesCount = Array.isArray(notes) ? notes.length : 0;
    const chunksCount = Array.isArray(processed?.chunks) ? processed.chunks.length : 0;
    const hasProcessedContent = Boolean(processed && (processed.chunks?.length > 0 || processed.normalizedText));

    return {
        learningOutputsCount,
        flashcardsCount,
        quizzesCount,
        attemptsCount,
        notesCount,
        chunksCount,
        hasProcessedContent,
    };
}

/**
 * Batch-load capability counts for all resources in parallel.
 * Executes only 4 IndexedDB transactions total and aggregates in memory.
 *
 * @param {object[]} resources
 * @returns {Promise<Map<string, {
 *   learningOutputsCount: number,
 *   flashcardsCount: number,
 *   quizzesCount: number,
 *   attemptsCount: number,
 *   notesCount: number
 * }>>}
 */
export async function getAllResourceCounts(resources = []) {
    const countsMap = new Map();
    resources.forEach((r) => {
        countsMap.set(r.id, {
            learningOutputsCount: 0,
            flashcardsCount: 0,
            quizzesCount: 0,
            attemptsCount: 0,
            notesCount: 0,
        });
    });

    if (resources.length === 0) return countsMap;

    try {
        const [allOutputs, allQuizzes, allNotes, allAttempts] = await Promise.all([
            learningOutputRepository.getAllLearningOutputs().catch(() => []),
            quizRepository.getAllQuizzes().catch(() => []),
            noteRepository.getAllNotes().catch(() => []),
            quizAttemptRepository.getAllAttempts().catch(() => []),
        ]);

        allOutputs.forEach((output) => {
            const counts = countsMap.get(output.resourceId);
            if (counts) {
                if (output.type === 'flashcard') {
                    counts.flashcardsCount += 1;
                } else if (output.type !== 'quiz') {
                    counts.learningOutputsCount += 1;
                }
            }
        });

        allQuizzes.forEach((quiz) => {
            const counts = countsMap.get(quiz.resourceId);
            if (counts) counts.quizzesCount += 1;
        });

        allNotes.forEach((note) => {
            const counts = countsMap.get(note.resourceId);
            if (counts) counts.notesCount += 1;
        });

        allAttempts.forEach((attempt) => {
            const counts = countsMap.get(attempt.resourceId);
            if (counts) counts.attemptsCount += 1;
        });
    } catch (err) {
        console.warn('StudyLens could not batch load resource capability counts.', err);
    }

    return countsMap;
}
