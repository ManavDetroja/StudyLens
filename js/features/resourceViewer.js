import { notifyResourcesChanged } from '../core/resourceEvents.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { closeDialog, openDialog } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { openTextResourceForm } from './resourceForm.js';
import { deleteProcessedContent, getProcessedContent } from './processingIntegration.js';

let activeResource = null;
let pendingDeleteId = null;

function viewerDialog() {
    return document.getElementById('resource-viewer-dialog');
}

function deleteDialog() {
    return document.getElementById('delete-resource-dialog');
}

export function formatResourceDate(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? 'Unknown date'
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function renderResourceContent(contentElement, content) {
    contentElement.textContent = content || 'No text content is available for this resource.';
}

function renderTags(tags) {
    const container = document.querySelector('[data-resource-viewer-tags]');
    const emptyState = document.querySelector('[data-resource-viewer-no-tags]');
    if (!container || !emptyState) return;

    container.replaceChildren();
    if (!tags.length) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;
    tags.forEach((tag) => {
        const item = document.createElement('li');
        item.className = 'resource-tag';
        item.textContent = tag;
        container.append(item);
    });
}

function renderResource(resource, processed = null) {
    document.querySelector('[data-resource-viewer-title]').textContent = resource.title;
    document.querySelector('[data-resource-viewer-type]').textContent = resource.type;
    document.querySelector('[data-resource-viewer-date]').textContent = 'Created ' + formatResourceDate(resource.createdAt);
    document.querySelector('[data-resource-viewer-status]').textContent = resource.status;
    document.querySelector('[data-resource-viewer-edit]').hidden = resource.type !== 'text';

    /* Updated date — show only when meaningfully different from created date */
    const updatedElement = document.querySelector('[data-resource-viewer-updated]');
    if (updatedElement) {
        const hasUpdate = resource.updatedAt && resource.updatedAt !== resource.createdAt;
        updatedElement.textContent = hasUpdate ? 'Updated ' + formatResourceDate(resource.updatedAt) : '';
        updatedElement.hidden = !hasUpdate;
    }

    /* Source — show only when it contains useful information */
    const sourceElement = document.querySelector('[data-resource-viewer-source]');
    if (sourceElement) {
        const hasSource = resource.source && resource.source !== 'manual://text-entry' && resource.source.trim() !== '';
        sourceElement.textContent = hasSource ? resource.source : '';
        sourceElement.hidden = !hasSource;
    }

    /* Processed content indicator */
    const processedElement = document.querySelector('[data-resource-viewer-processed]');
    if (processedElement) {
        if (processed && Array.isArray(processed.chunks) && processed.chunks.length > 0) {
            const count = processed.chunks.length;
            processedElement.textContent = count === 1 ? '1 chunk processed' : count + ' chunks processed';
            processedElement.hidden = false;
        } else {
            processedElement.textContent = '';
            processedElement.hidden = true;
        }
    }

    renderResourceContent(document.querySelector('[data-resource-viewer-content]'), resource.content);
    renderTags(resource.tags);
}

export async function openResourceViewer(resourceId) {
    try {
        const resource = await resourceRepository.getResource(resourceId);
        if (!resource) {
            showToast('This resource is no longer available.', { variant: 'error' });
            return;
        }

        let processed = null;
        try {
            processed = await getProcessedContent(resourceId);
        } catch {
            // Processed content is an enhancement; proceed if unavailable
        }

        activeResource = resource;
        renderResource(resource, processed);
        openDialog(viewerDialog());
    } catch (error) {
        console.error('StudyLens could not open the resource.', error);
        showToast('StudyLens could not open this resource. Please try again.', { variant: 'error' });
    }
}

export function initResourceViewer() {
    document.querySelector('[data-resource-viewer-edit]')?.addEventListener('click', () => {
        if (!activeResource || activeResource.type !== 'text') return;
        closeDialog(viewerDialog());
        openTextResourceForm(activeResource);
    });

    document.querySelector('[data-resource-viewer-delete]')?.addEventListener('click', () => {
        if (!activeResource) return;
        pendingDeleteId = activeResource.id;
        closeDialog(viewerDialog());
        openDialog(deleteDialog());
        document.querySelector('[data-delete-resource-confirm]')?.focus();
    });

    document.querySelector('[data-delete-resource-confirm]')?.addEventListener('click', async () => {
        if (!pendingDeleteId) return;

        const confirmButton = document.querySelector('[data-delete-resource-confirm]');
        confirmButton.disabled = true;
        confirmButton.textContent = 'Deleting…';

        try {
            const deleted = await resourceRepository.deleteResource(pendingDeleteId);
            closeDialog(deleteDialog());
            if (!deleted) {
                showToast('This resource is no longer available.', { variant: 'error' });
                return;
            }

            try {
                await deleteProcessedContent(pendingDeleteId);
            } catch (cleanupError) {
                console.warn('StudyLens could not clean up processed content for deleted resource.', cleanupError);
            }

            notifyResourcesChanged({ action: 'deleted', resourceId: pendingDeleteId });
            showToast('Resource deleted.');
            activeResource = null;
            pendingDeleteId = null;
        } catch (error) {
            console.error('StudyLens could not delete the resource.', error);
            showToast('StudyLens could not delete this resource. Please try again.', { variant: 'error' });
        } finally {
            confirmButton.disabled = false;
            confirmButton.textContent = 'Delete resource';
        }
    });
}
