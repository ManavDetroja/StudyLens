import { DatabaseConnection } from '../js/storage/indexedDB.js';
import { createTextResourceInput, createTextResourceUpdate } from '../js/features/textResourceInput.js';
import { ResourceRepository } from '../js/storage/resourceStore.js';
import { ProcessedContentRepository } from '../js/storage/processedContentStore.js';
import { LearningOutputRepository } from '../js/storage/learningOutputStore.js';
import { QuizRepository } from '../js/storage/quizStore.js';
import { QuizAttemptRepository } from '../js/storage/quizAttemptStore.js';
import { NoteRepository } from '../js/storage/noteStore.js';
import { processAndStore, getProcessedContent, deleteProcessedContent } from '../js/features/processingIntegration.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function expectRejected(action, expectedCode) {
    try {
        await action();
    } catch (error) {
        assert(error.code === expectedCode, 'Expected error code ' + expectedCode + ', received ' + error.code + '.');
        return;
    }

    throw new Error('Expected the action to reject.');
}

function deleteTestDatabase(indexedDBFactory, databaseName) {
    return new Promise((resolve, reject) => {
        const request = indexedDBFactory.deleteDatabase(databaseName);
        request.addEventListener('success', () => resolve());
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('blocked', () => reject(new Error('The temporary test database is blocked.')));
    });
}

export async function runStorageBrowserSuite() {
    if (!globalThis.indexedDB) {
        throw new Error('Native IndexedDB is unavailable in this browser.');
    }

    const databaseName = 'StudyLensDB-Day3Test-' + globalThis.crypto.randomUUID();
    const timestamps = [
        '2026-09-18T00:00:00.000Z',
        '2026-09-18T00:01:00.000Z',
    ];
    let idCounter = 0;
    const connection = new DatabaseConnection({ databaseName });
    const repository = new ResourceRepository({
        database: connection,
        idGenerator: () => 'resource-' + (++idCounter),
        clock: () => new Date(timestamps.shift() ?? '2026-09-18T00:02:00.000Z'),
    });
    const processedRepository = new ProcessedContentRepository({
        database: connection,
    });
    const outputRepository = new LearningOutputRepository({
        database: connection,
    });
    const quizRepository = new QuizRepository({
        database: connection,
    });
    const attemptRepository = new QuizAttemptRepository({
        database: connection,
    });
    const noteRepository = new NoteRepository({
        database: connection,
    });
    const results = [];

    try {
        const database = await connection.open();
        assert(database.objectStoreNames.contains('resources'), 'The resources store was not created.');
        const resourceStore = database.transaction('resources', 'readonly').objectStore('resources');
        ['type', 'createdAt', 'updatedAt', 'status'].forEach((index) => {
            assert(resourceStore.indexNames.contains(index), 'Missing resources index: ' + index + '.');
        });

        assert(database.objectStoreNames.contains('processedContent'), 'The processedContent store was not created.');
        const processedStore = database.transaction('processedContent', 'readonly').objectStore('processedContent');
        assert(processedStore.indexNames.contains('resourceId'), 'Missing processedContent index: resourceId.');
        assert(processedStore.index('resourceId').unique === true, 'resourceId index must be unique.');

        assert(database.objectStoreNames.contains('learningOutputs'), 'The learningOutputs store was not created.');
        const outputStore = database.transaction('learningOutputs', 'readonly').objectStore('learningOutputs');
        ['resourceId', 'type', 'createdAt'].forEach((index) => {
            assert(outputStore.indexNames.contains(index), 'Missing learningOutputs index: ' + index + '.');
        });
        assert(database.objectStoreNames.contains('quizzes'), 'The quizzes store was not created.');
        const quizStore = database.transaction('quizzes', 'readonly').objectStore('quizzes');
        ['resourceId', 'createdAt'].forEach((index) => {
            assert(quizStore.indexNames.contains(index), 'Missing quizzes index: ' + index + '.');
        });
        assert(database.objectStoreNames.contains('quizAttempts'), 'The quizAttempts store was not created.');
        const attemptStore = database.transaction('quizAttempts', 'readonly').objectStore('quizAttempts');
        ['quizId', 'resourceId', 'completedAt', 'createdAt'].forEach((index) => {
            assert(attemptStore.indexNames.contains(index), 'Missing quizAttempts index: ' + index + '.');
        });
        assert(database.objectStoreNames.contains('notes'), 'The notes store was not created.');
        const noteStore = database.transaction('notes', 'readonly').objectStore('notes');
        ['resourceId', 'updatedAt', 'createdAt'].forEach((index) => {
            assert(noteStore.indexNames.contains(index), 'Missing notes index: ' + index + '.');
        });
        results.push('Database schema and indexes created (v6 with notes)');

        const created = await repository.createResource(createTextResourceInput({
            title: ' Storage test resource ',
            content: ' Temporary test content ',
            tags: 'test, browser, test',
        }));
        assert(created.id === 'resource-1', 'Created resource id did not match.');
        assert(created.status === 'completed', 'Manual text resources must be completed.');
        assert(created.content === 'Temporary test content', 'Text content was not normalized.');
        assert(JSON.stringify(created.tags) === JSON.stringify(['test', 'browser']), 'Tags were not normalized.');
        results.push('Text-resource create and read');

        const read = await repository.getResource(created.id);
        assert(read?.title === 'Storage test resource', 'Resource could not be read by id.');
        assert((await repository.getAllResources()).length === 1, 'Read-all did not return the resource.');
        assert((await repository.getResourcesByType('text')).length === 1, 'Type index did not return the resource.');

        const updated = await repository.updateResource(created.id, createTextResourceUpdate({
            title: 'Updated storage test resource',
            content: 'Updated temporary test content',
            tags: 'updated, test',
        }));
        assert(updated.title === 'Updated storage test resource', 'Resource title was not updated.');
        assert(updated.status === 'completed', 'Resource status was not updated.');
        assert(updated.id === created.id, 'Update changed the resource id.');
        assert(updated.createdAt === created.createdAt, 'Update changed createdAt.');
        assert(updated.updatedAt !== created.updatedAt, 'Update did not change updatedAt.');
        assert((await repository.getResourcesByStatus('completed')).length === 1, 'Status index did not return the resource.');
        assert(await repository.countResources() === 1, 'Dashboard count would not reflect resources.');
        results.push('Update, count, and indexed reads');

        const duplicateRepository = new ResourceRepository({
            database: connection,
            idGenerator: () => created.id,
            clock: () => new Date('2026-09-18T00:03:00.000Z'),
        });
        await expectRejected(() => duplicateRepository.createResource({
            title: 'Duplicate resource',
            type: 'text',
            source: 'manual://duplicate',
        }), 'DUPLICATE_RESOURCE_ID');

        await expectRejected(() => repository.createResource({
            title: '',
            type: 'text',
            source: 'manual://invalid',
        }), 'INVALID_RESOURCE');
        results.push('Duplicate and validation errors');

        connection.close();
        await connection.open();
        const persisted = await repository.getResource(created.id);
        assert(persisted?.status === 'completed', 'Resource was not available after reopening the database.');
        results.push('Persistence after reopen');

        const processed = await processAndStore(created, { resRepo: repository, processedRepo: processedRepository });
        assert(processed.resourceId === created.id, 'Processed content resourceId mismatch.');
        assert(processed.normalizedText === 'Temporary test content', 'Normalized text mismatch.');
        assert(processed.chunks.length > 0, 'Processed chunks missing.');
        assert(await processedRepository.getByResourceId(created.id) !== null, 'Processed content could not be read.');
        results.push('Processed content creation and storage');

        // Reprocess on updated resource
        const reprocessed = await processAndStore(updated, { resRepo: repository, processedRepo: processedRepository });
        assert(reprocessed.resourceId === created.id, 'Reprocessed resourceId changed.');
        assert(reprocessed.normalizedText === 'Updated temporary test content', 'Reprocessed text did not update.');
        results.push('Reprocessing on resource edit');

        // Cleanup processed content
        assert(await deleteProcessedContent(created.id, processedRepository), 'Delete processed content failed.');
        assert(await processedRepository.getByResourceId(created.id) === null, 'Processed content was still available after deletion.');
        results.push('Processed content deletion and cleanup');

        // Day 9: Learning outputs creation, indexed queries, and cleanup
        const outputSummary = await outputRepository.createLearningOutput({
            resourceId: created.id,
            type: 'summary',
            content: 'Summary of storage test resource.',
            sourceChunkIds: [0],
        });
        const outputQuestion = await outputRepository.createLearningOutput({
            resourceId: created.id,
            type: 'question',
            content: 'What does this resource test?',
            sourceChunkIds: [0],
        });
        assert(outputSummary.resourceId === created.id, 'Learning output resourceId mismatch.');
        assert((await outputRepository.getLearningOutput(outputSummary.id)) !== null, 'Output could not be retrieved by ID.');
        assert((await outputRepository.getLearningOutputsByResourceId(created.id)).length === 2, 'Resource outputs count mismatch.');
        assert((await outputRepository.getLearningOutputsByType('summary')).length === 1, 'Summary type count mismatch.');
        results.push('Learning output creation and indexed queries');

        // Delete learning outputs for resource
        const deletedOutputsCount = await outputRepository.deleteLearningOutputsByResourceId(created.id);
        assert(deletedOutputsCount === 2, 'Expected 2 deleted learning outputs.');
        assert((await outputRepository.getLearningOutputsByResourceId(created.id)).length === 0, 'Outputs remained after deletion.');
        results.push('Learning output cascade deletion');

        // Quiz creation and queries
        const createdQuiz = await quizRepository.createQuiz({
            resourceId: created.id,
            title: 'Test Quiz',
            questions: [
                {
                    id: 'q-test-1',
                    question: 'What is tested?',
                    options: ['Storage', 'Network'],
                    correctAnswer: 'Storage',
                    sourceChunkIds: [0],
                    order: 0,
                },
            ],
            metadata: { questionCount: 1 },
        });
        assert(createdQuiz.resourceId === created.id, 'Quiz resourceId mismatch.');
        assert((await quizRepository.getQuiz(createdQuiz.id)) !== null, 'Quiz could not be retrieved by ID.');
        assert((await quizRepository.getQuizzesByResourceId(created.id)).length === 1, 'Resource quizzes count mismatch.');
        assert((await quizRepository.getAllQuizzes()).length === 1, 'All quizzes count mismatch.');
        assert((await quizRepository.countQuizzes()) === 1, 'Count quizzes mismatch.');
        results.push('Quiz creation and indexed queries');

        // Delete quiz for resource
        const deletedQuizzesCount = await quizRepository.deleteQuizzesByResourceId(created.id);
        assert(deletedQuizzesCount === 1, 'Expected 1 deleted quiz.');
        assert((await quizRepository.getQuizzesByResourceId(created.id)).length === 0, 'Quiz remained after deletion.');
        results.push('Quiz cascade deletion');

        // Quiz attempt creation and queries
        const createdAttempt = await attemptRepository.createQuizAttempt({
            quizId: createdQuiz.id,
            resourceId: created.id,
            quizTitle: 'Test Quiz',
            score: 1,
            correctCount: 1,
            incorrectCount: 0,
            unansweredCount: 0,
            totalQuestions: 1,
            percentage: 100,
            answers: { 'q-test-1': 'Storage' },
            questionResults: [{
                questionId: 'q-test-1',
                question: 'What is tested?',
                selectedAnswer: 'Storage',
                correctAnswer: 'Storage',
                isCorrect: true,
                isUnanswered: false,
                sourceChunkIds: [0],
            }],
            startedAt: '2026-09-18T00:04:00.000Z',
            completedAt: '2026-09-18T00:04:30.000Z',
        });
        assert(createdAttempt.resourceId === created.id, 'Attempt resourceId mismatch.');
        assert(createdAttempt.quizId === createdQuiz.id, 'Attempt quizId mismatch.');
        assert((await attemptRepository.getQuizAttempt(createdAttempt.id)) !== null, 'Attempt could not be retrieved by ID.');
        assert((await attemptRepository.getAttemptsByQuiz(createdQuiz.id)).length === 1, 'Quiz attempts count mismatch.');
        assert((await attemptRepository.getAttemptsByResource(created.id)).length === 1, 'Resource attempts count mismatch.');
        assert((await attemptRepository.getAllAttempts()).length === 1, 'All attempts count mismatch.');
        assert((await attemptRepository.countAttempts()) === 1, 'Count attempts mismatch.');
        results.push('Quiz attempt creation and indexed queries');

        // Delete attempts for resource
        const deletedAttemptsCount = await attemptRepository.deleteAttemptsByResource(created.id);
        assert(deletedAttemptsCount === 1, 'Expected 1 deleted attempt.');
        assert((await attemptRepository.getAttemptsByResource(created.id)).length === 0, 'Attempts remained after deletion.');
        results.push('Quiz attempt cascade deletion');

        // Note creation and queries
        const createdNote = await noteRepository.createNote({
            resourceId: created.id,
            title: 'Browser Note',
            content: 'Test content for note',
            tags: ['indexeddb', 'browser'],
        });
        assert(createdNote.resourceId === created.id, 'Note resourceId mismatch.');
        assert((await noteRepository.getNote(createdNote.id)) !== null, 'Note could not be retrieved by ID.');
        assert((await noteRepository.getNotesByResource(created.id)).length === 1, 'Resource notes count mismatch.');
        assert((await noteRepository.getAllNotes()).length === 1, 'All notes count mismatch.');
        assert((await noteRepository.countNotes()) === 1, 'Count notes mismatch.');
        results.push('Note creation and indexed queries');

        // Note update
        const updatedNote = await noteRepository.updateNote(createdNote.id, {
            content: 'Updated content for note',
        });
        assert(updatedNote.content === 'Updated content for note', 'Updated content mismatch.');
        assert(updatedNote.id === createdNote.id, 'Note ID must remain immutable.');
        assert(updatedNote.createdAt === createdNote.createdAt, 'Note createdAt must remain immutable.');
        results.push('Note update');

        // Delete notes for resource
        const deletedNotesCount = await noteRepository.deleteNotesByResource(created.id);
        assert(deletedNotesCount === 1, 'Expected 1 deleted note.');
        assert((await noteRepository.getNotesByResource(created.id)).length === 0, 'Notes remained after deletion.');
        results.push('Note cascade deletion');

        assert(await repository.deleteResource(created.id), 'Delete did not report success.');
        assert(await repository.getResource(created.id) === null, 'Deleted resource was still available.');
        assert((await repository.clearResources()) === 0, 'Clear did not report the expected empty count.');
        results.push('Delete and clear');
    } finally {
        connection.close();
        await deleteTestDatabase(globalThis.indexedDB, databaseName);
    }

    return results;
}
