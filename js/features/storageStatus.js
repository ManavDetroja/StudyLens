import { initializeDatabase } from '../storage/indexedDB.js';
import { resourceRepository } from '../storage/resourceStore.js';

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

export async function initializeApplicationStorage() {
    try {
        await initializeDatabase();
        setResourceCount(await resourceRepository.countResources());
        document.documentElement.dataset.storageState = 'ready';
        return true;
    } catch (error) {
        document.documentElement.dataset.storageState = 'unavailable';
        showStorageError();
        console.error('StudyLens storage initialization failed.', error);
        return false;
    }
}
