import { initNavigation } from './ui/navigation.js';
import { initModal } from './ui/modal.js';
import { initResourceActions } from './features/resourceForm.js';
import { initResourceList } from './features/resourceList.js';
import { initResourceViewer } from './features/resourceViewer.js';
import { initFlashcardPage } from './features/flashcardPage.js';
import { initFlashcardViewer } from './features/flashcardViewer.js';
import { initializeApplicationStorage } from './features/storageStatus.js';

async function initApp() {
    initModal();
    initNavigation();
    initResourceActions();
    initResourceViewer();
    initFlashcardViewer();
    const storageReady = await initializeApplicationStorage();
    if (storageReady) {
        await initResourceList();
        initFlashcardPage();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    void initApp();
});
