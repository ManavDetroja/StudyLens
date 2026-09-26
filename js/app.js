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
import { initializeApplicationStorage } from './features/storageStatus.js';

async function initApp() {
    initModal();
    initNavigation();
    initResourceActions();
    initResourceViewer();
    initFlashcardViewer();
    initQuizPlayer();
    const storageReady = await initializeApplicationStorage();
    if (storageReady) {
        await initResourceList();
        initFlashcardPage();
        initQuizPage();
        initAnalyticsPage();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    void initApp();
});

