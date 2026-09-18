import { initNavigation } from './ui/navigation.js';
import { initModal } from './ui/modal.js';
import { initResourceActions } from './features/resourceForm.js';

function initApp() {
    initModal();
    initNavigation();
    initResourceActions();
}

document.addEventListener('DOMContentLoaded', initApp);
