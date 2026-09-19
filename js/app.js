import { initNavigation } from './ui/navigation.js';
import { initModal } from './ui/modal.js';
import { initResourceActions } from './features/resourceForm.js';
import { initResourceList } from './features/resourceList.js';
import { initResourceViewer } from './features/resourceViewer.js';
import { initializeApplicationStorage } from './features/storageStatus.js';

async function initApp() {
    initModal();
    initNavigation();
    initResourceActions();
    initResourceViewer();
    const storageReady = await initializeApplicationStorage();
    if (storageReady) await initResourceList();
}

document.addEventListener('DOMContentLoaded', () => {
    void initApp();
});
