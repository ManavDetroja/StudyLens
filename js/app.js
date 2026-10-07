import { initNavigation } from './ui/navigation.js';
import { initModal } from './ui/modal.js';
import { initResourceActions } from './features/resourceForm.js';
import { initResourceList } from './features/resourceList.js';
import { initResourceViewer } from './features/resourceViewer.js';
import { initFlashcardPage } from './features/flashcardPage.js';
import { initFlashcardViewer } from './features/flashcardViewer.js';
import { initQuizPage } from './features/quizPage.js';
import { initQuizPlayer } from './features/quizPlayer.js';
import { initAnalyticsPage } from './features/analyticsPage.js';
import { initNotesPage } from './features/notesPage.js';
import { initNoteEditor } from './features/noteEditor.js';
import { initStudySessionUI } from './features/studySessionUI.js';
import { initFileImportForm } from './features/fileImportForm.js';
import { initVideoResourceForm } from './features/videoResourceForm.js';
import { initializeApplicationStorage } from './features/storageStatus.js';
import { initProcessingIndicator } from './features/processingIndicator.js';

async function initApp() {
    initModal();
    initNavigation();
    initResourceActions();
    initFileImportForm();
    initVideoResourceForm();
    initResourceViewer();
    initFlashcardViewer();
    initQuizPlayer();
    initNoteEditor();
    initStudySessionUI();
    const storageReady = await initializeApplicationStorage();
    if (storageReady) {
        await initProcessingIndicator();
        await initResourceList();
        initNotesPage();
        initFlashcardPage();
        initQuizPage();
        initAnalyticsPage();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    void initApp();
});

