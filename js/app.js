import { initNavigation } from './ui/navigation.js';
import { initModal } from './ui/modal.js';
import { initResourceActions } from './features/resourceForm.js';
import { initializeApplicationStorage } from './features/storageStatus.js';

async function initApp() {
    initModal();
    initNavigation();
    initResourceActions();
    await initializeApplicationStorage();
}

document.addEventListener('DOMContentLoaded', () => {
    void initApp();
});
