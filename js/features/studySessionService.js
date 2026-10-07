/**
 * Study Session Service — Day 24.
 *
 * Orchestrates study sessions:
 * - Validates resource readiness for study
 * - Dynamically plans available study steps based on actual persisted data
 * - Tracks active in-memory session lifecycle (start, step completion, finish, abandon)
 * - Measures real elapsed duration (no fabricated or simulated time)
 * - Persists completed and abandoned session records in IndexedDB
 * - Exposes session history for resources
 */

import { resourceRepository } from '../storage/resourceStore.js';
import { studySessionRepository } from '../storage/studySessionStore.js';
import {
    createStudySessionRecord,
    createUpdatedStudySession,
    calculateElapsedMs,
    formatSessionDuration,
} from '../storage/studySessionValidation.js';
import { getProcessedContent } from './processingIntegration.js';
import { learningOutputRepository } from '../storage/learningOutputStore.js';
import { getFlashcardsForResource } from './flashcardService.js';
import { getQuizForResource } from './quizService.js';
import { noteRepository } from '../storage/noteStore.js';

let activeSessionState = null;

/**
 * Assess if a resource can enter Study Session mode.
 *
 * @param {object} resource
 * @param {object} [options]
 * @param {object} [options.processed]
 * @returns {{ ready: boolean, reason?: string, message?: string }}
 */
export function assessResourceReadiness(resource, options = {}) {
    if (!resource) {
        return {
            ready: false,
            reason: 'RESOURCE_NOT_FOUND',
            message: 'Resource could not be found.',
        };
    }

    if (resource.status === 'processing') {
        return {
            ready: false,
            reason: 'RESOURCE_PROCESSING',
            message: 'This resource is currently processing. Please wait until processing finishes.',
        };
    }

    const hasProcessed = Boolean(options.processed?.normalizedText || options.processed?.chunks?.length);
    const hasRawContent = typeof resource.content === 'string' && resource.content.trim().length > 0;

    if (!hasProcessed && !hasRawContent && resource.status === 'pending') {
        return {
            ready: false,
            reason: 'RESOURCE_NOT_PROCESSED',
            message: 'Process this resource before starting a study session.',
        };
    }

    return { ready: true };
}

/**
 * Dynamically plans the study steps available for a resource.
 *
 * @param {object} context
 * @param {object[]} [context.outputs]
 * @param {object[]} [context.flashcards]
 * @param {object|null} [context.quiz]
 * @param {object[]} [context.notes]
 * @returns {Array<{ id: string, label: string, available: boolean, count: number, description: string }>}
 */
export function planSessionSteps({ outputs = [], flashcards = [], quiz = null, notes = [] } = {}) {
    const studyOutputs = outputs.filter((o) => o.type !== 'flashcard' && o.type !== 'quiz');
    const hasOutputs = studyOutputs.length > 0;
    const hasFlashcards = Array.isArray(flashcards) && flashcards.length > 0;
    const hasQuiz = Boolean(quiz && Array.isArray(quiz.questions) && quiz.questions.length > 0);
    const notesCount = Array.isArray(notes) ? notes.length : 0;

    const steps = [
        {
            id: 'overview',
            label: 'Overview',
            available: true,
            count: 1,
            description: 'Resource overview and study roadmap',
        },
        {
            id: 'outputs',
            label: 'Learning Outputs',
            available: hasOutputs,
            count: studyOutputs.length,
            description: hasOutputs
                ? `${studyOutputs.length} study items (summary, concepts, definitions, questions)`
                : 'No learning outputs generated yet',
        },
        {
            id: 'flashcards',
            label: 'Flashcards',
            available: hasFlashcards,
            count: hasFlashcards ? flashcards.length : 0,
            description: hasFlashcards
                ? `${flashcards.length} flashcards for active recall`
                : 'No flashcards generated yet',
        },
        {
            id: 'quiz',
            label: 'Quiz',
            available: hasQuiz,
            count: hasQuiz ? quiz.questions.length : 0,
            description: hasQuiz
                ? `${quiz.questions.length} practice questions`
                : 'No quiz generated yet',
        },
        {
            id: 'summary',
            label: 'Summary',
            available: true,
            count: 1,
            description: 'Session completion results and stats',
        },
    ];

    return steps;
}

/**
 * Load complete study material data for a resource.
 *
 * @param {string} resourceId
 * @returns {Promise<{
 *   resource: object,
 *   processed: object|null,
 *   outputs: object[],
 *   flashcards: object[],
 *   quiz: object|null,
 *   notes: object[],
 *   steps: object[],
 *   readiness: object
 * }>}
 */
export async function loadStudySessionData(resourceId) {
    if (!resourceId || typeof resourceId !== 'string') {
        throw new Error('A valid resourceId is required.');
    }

    const resource = await resourceRepository.getResource(resourceId);
    if (!resource) {
        throw new Error('This resource is no longer available.');
    }

    const [processed, outputs, flashcards, quiz, notes] = await Promise.all([
        getProcessedContent(resourceId).catch(() => null),
        learningOutputRepository.getLearningOutputsByResourceId(resourceId).catch(() => []),
        getFlashcardsForResource(resourceId).catch(() => []),
        getQuizForResource(resourceId).catch(() => null),
        noteRepository.getNotesByResource(resourceId).catch(() => []),
    ]);

    const readiness = assessResourceReadiness(resource, { processed });
    const steps = planSessionSteps({ outputs, flashcards, quiz, notes });

    return {
        resource,
        processed,
        outputs,
        flashcards,
        quiz,
        notes,
        steps,
        readiness,
    };
}

/**
 * Start a new active study session for a resource.
 *
 * @param {string} resourceId
 * @param {object} [options]
 * @returns {Promise<{ session: object, steps: object[] }>}
 */
export async function startStudySession(resourceId, options = {}) {
    const data = await loadStudySessionData(resourceId);
    if (!data.readiness.ready) {
        throw new Error(data.readiness.message || 'Cannot start study session for this resource.');
    }

    const startedAt = new Date().toISOString();
    const sessionRecord = createStudySessionRecord({
        resourceId,
        startedAt,
        status: 'active',
        stepsCompleted: ['overview'],
        metadata: {
            resourceTitle: data.resource.title,
            resourceType: data.resource.type,
            hasOutputs: data.steps.find((s) => s.id === 'outputs')?.available ?? false,
            hasFlashcards: data.steps.find((s) => s.id === 'flashcards')?.available ?? false,
            hasQuiz: data.steps.find((s) => s.id === 'quiz')?.available ?? false,
            ...options.metadata,
        },
    });

    activeSessionState = {
        session: sessionRecord,
        data,
        timerStartTime: Date.now(),
        currentStepIndex: 0,
    };

    return {
        session: sessionRecord,
        data,
    };
}

/**
 * Retrieve the current active in-memory session state.
 *
 * @returns {object|null}
 */
export function getActiveSessionState() {
    return activeSessionState;
}

/**
 * Calculate current elapsed milliseconds for active session.
 *
 * @returns {number}
 */
export function getActiveSessionElapsedMs() {
    if (!activeSessionState) return 0;
    return calculateElapsedMs(activeSessionState.session.startedAt);
}

/**
 * Mark a step as completed in the active session.
 *
 * @param {string} stepId
 */
export function markStepCompleted(stepId) {
    if (!activeSessionState || !stepId) return;
    const currentSteps = activeSessionState.session.stepsCompleted || [];
    if (!currentSteps.includes(stepId)) {
        activeSessionState.session = createUpdatedStudySession(activeSessionState.session, {
            stepsCompleted: [...currentSteps, stepId],
        });
    }
}

/**
 * Complete and persist the active study session.
 *
 * @param {object} [summaryData]
 * @returns {Promise<object>} persisted StudySession record
 */
export async function completeStudySession(summaryData = {}) {
    if (!activeSessionState) {
        throw new Error('No active study session to complete.');
    }

    const completedAt = new Date().toISOString();
    const durationMs = calculateElapsedMs(activeSessionState.session.startedAt, completedAt);

    const stepsCompleted = [
        ...new Set([...(activeSessionState.session.stepsCompleted || []), 'summary']),
    ];

    const completedSession = createUpdatedStudySession(activeSessionState.session, {
        completedAt,
        status: 'completed',
        durationMs,
        stepsCompleted,
        metadata: {
            ...activeSessionState.session.metadata,
            ...summaryData,
        },
    });

    // Persist into IndexedDB
    const saved = await studySessionRepository.saveSession(completedSession);
    activeSessionState = null;
    return saved;
}

/**
 * Abandon and optionally persist the active study session.
 *
 * @returns {Promise<object|null>}
 */
export async function abandonStudySession() {
    if (!activeSessionState) return null;

    const completedAt = new Date().toISOString();
    const durationMs = calculateElapsedMs(activeSessionState.session.startedAt, completedAt);

    const abandonedSession = createUpdatedStudySession(activeSessionState.session, {
        completedAt,
        status: 'abandoned',
        durationMs,
    });

    try {
        await studySessionRepository.saveSession(abandonedSession);
    } catch (err) {
        console.warn('StudyLens could not persist abandoned session record.', err);
    }

    activeSessionState = null;
    return abandonedSession;
}

/**
 * Retrieve session history for a resource.
 *
 * @param {string} resourceId
 * @returns {Promise<object[]>}
 */
export async function getResourceSessionHistory(resourceId) {
    return studySessionRepository.getSessionsByResource(resourceId);
}
