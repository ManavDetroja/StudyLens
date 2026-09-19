import { onResourcesChanged } from '../core/resourceEvents.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { showToast } from '../ui/toast.js';
import { refreshDashboardResourceCount } from './storageStatus.js';
import { formatResourceDate, openResourceViewer } from './resourceViewer.js';

function createMetadata(resource) {
    const metadata = document.createElement('div');
    metadata.className = 'resource-card-meta';
    const date = document.createElement('span');
    date.textContent = formatResourceDate(resource.createdAt);
    const status = document.createElement('span');
    status.className = 'resource-status';
    status.textContent = resource.status;
    metadata.append(date, status);
    return metadata;
}

function createTags(tags) {
    const tagList = document.createElement('ul');
    tagList.className = 'resource-tags';
    tags.forEach((tag) => {
        const item = document.createElement('li');
        item.className = 'resource-tag';
        item.textContent = tag;
        tagList.append(item);
    });
    return tagList;
}

export function createResourceCard(resource, { compact = false } = {}) {
    const card = document.createElement('article');
    card.className = compact ? 'resource-card resource-card-compact' : 'resource-card';
    const heading = document.createElement(compact ? 'h3' : 'h2');
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'resource-card-title';
    openButton.dataset.resourceOpen = resource.id;
    openButton.textContent = resource.title;
    heading.append(openButton);

    const type = document.createElement('span');
    type.className = 'badge resource-type';
    type.textContent = resource.type;
    card.append(heading, type, createMetadata(resource));
    if (resource.tags.length) card.append(createTags(resource.tags));
    return card;
}

function renderResourceCollection({ listSelector, emptySelector, resources, compact = false }) {
    const list = document.querySelector(listSelector);
    const emptyState = document.querySelector(emptySelector);
    if (!list || !emptyState) return;

    list.replaceChildren(...resources.map((resource) => createResourceCard(resource, { compact })));
    list.hidden = resources.length === 0;
    emptyState.hidden = resources.length !== 0;
}

function bindResourceSelection(selector) {
    document.querySelector(selector)?.addEventListener('click', (event) => {
        const openButton = event.target.closest('[data-resource-open]');
        if (openButton) void openResourceViewer(openButton.dataset.resourceOpen);
    });
}

export async function refreshResourceDisplays() {
    try {
        const resources = await resourceRepository.getAllResources();
        renderResourceCollection({
            listSelector: '[data-recent-resources-list]',
            emptySelector: '[data-recent-resources-empty]',
            resources: resources.slice(0, 3),
            compact: true,
        });
        renderResourceCollection({
            listSelector: '[data-library-resource-list]',
            emptySelector: '[data-library-empty]',
            resources,
        });
        await refreshDashboardResourceCount();
    } catch (error) {
        console.error('StudyLens could not refresh resource displays.', error);
        showToast('StudyLens could not load your resources. Please try again.', { variant: 'error' });
    }
}

export async function initResourceList() {
    bindResourceSelection('[data-recent-resources-list]');
    bindResourceSelection('[data-library-resource-list]');
    onResourcesChanged(() => {
        void refreshResourceDisplays();
    });
    await refreshResourceDisplays();
}
