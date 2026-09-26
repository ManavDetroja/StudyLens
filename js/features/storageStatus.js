import { initializeDatabase } from '../storage/indexedDB.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { getFlashcardCount } from './flashcardService.js';
import { countQuizzes } from './quizService.js';
import { countNotes } from './noteService.js';
import { onLearningOutputsChanged, onQuizzesChanged, onNotesChanged } from '../core/resourceEvents.js';

function setResourceCount(count) {
    const counter = document.querySelector('[data-stat="resources"]');
    if (counter) counter.textContent = String(count);
}

function showStorageError() {
    const notice = document.querySelector('[data-storage-error]');
    if (!notice) return;
    notice.hidden = false;
    notice.querySelector('[data-storage-error-message]').textContent = 'StudyLens could not open local storage. Resources cannot be saved until storage is available.';
}

export async function refreshDashboardResourceCount() {
    setResourceCount(await resourceRepository.countResources());
}

export async function refreshDashboardFlashcardCount() {
    const counter = document.querySelector('[data-stat="flashcards"]');
    if (!counter) return;
    try {
        const count = await getFlashcardCount();
        counter.textContent = String(count);
    } catch {
        counter.textContent = '0';
    }
}

export async function refreshDashboardQuizCount() {
    const counter = document.querySelector('[data-stat="quizzes"]');
    if (!counter) return;
    try {
        const count = await countQuizzes();
        counter.textContent = String(count);
    } catch {
        counter.textContent = '0';
    }
}

export async function refreshDashboardNoteCount() {
    const counter = document.querySelector('[data-stat="notes"]');
    if (!counter) return;
    try {
        const count = await countNotes();
        counter.textContent = String(count);
    } catch {
        counter.textContent = '0';
    }
}

// Reactively update dashboard flashcards stat when outputs change
onLearningOutputsChanged(() => {
    void refreshDashboardFlashcardCount();
});

// Reactively update dashboard quizzes stat when quizzes change
onQuizzesChanged(() => {
    void refreshDashboardQuizCount();
});

// Reactively update dashboard notes stat when notes change
onNotesChanged(() => {
    void refreshDashboardNoteCount();
});

export async function initializeApplicationStorage() {
    try {
        await initializeDatabase();
        await refreshDashboardResourceCount();
        await refreshDashboardFlashcardCount();
        await refreshDashboardQuizCount();
        await refreshDashboardNoteCount();
        document.documentElement.dataset.storageState = 'ready';
        return true;
    } catch (error) {
        document.documentElement.dataset.storageState = 'unavailable';
        showStorageError();
        console.error('StudyLens storage initialization failed.', error);
        return false;
    }
}

