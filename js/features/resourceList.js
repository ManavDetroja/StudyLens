import { onResourcesChanged } from '../core/resourceEvents.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { showToast } from '../ui/toast.js';
import { refreshDashboardResourceCount } from './storageStatus.js';
import { formatResourceDate, openResourceViewer } from './resourceViewer.js';
import { applyLibraryFilters, isFiltered } from '../algorithms/librarySearch.js';
import { collectAllTags } from '../utils/tagUtils.js';

/* ── Cached resource list ────────────────────────────────────────── */

let allResources = [];

/* ── Card rendering ──────────────────────────────────────────────── */

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

/* ── Dashboard rendering (unchanged from Day 4) ─────────────────── */

function renderResourceCollection({ listSelector, emptySelector, resources, compact = false }) {
    const list = document.querySelector(listSelector);
    const emptyState = document.querySelector(emptySelector);
    if (!list || !emptyState) return;

    list.replaceChildren(...resources.map((resource) => createResourceCard(resource, { compact })));
    list.hidden = resources.length === 0;
    emptyState.hidden = resources.length !== 0;
}

/* ── Library filter state ────────────────────────────────────────── */

function getLibraryFilters() {
    return {
        query: document.getElementById('library-search')?.value ?? '',
        type: document.getElementById('resource-type')?.value ?? 'all',
        status: document.getElementById('resource-status')?.value ?? 'all',
        tag: document.getElementById('resource-tag')?.value ?? 'all',
        sort: document.getElementById('library-sort')?.value ?? 'recent',
    };
}

function resetLibraryFilters() {
    const search = document.getElementById('library-search');
    const type = document.getElementById('resource-type');
    const status = document.getElementById('resource-status');
    const tag = document.getElementById('resource-tag');
    const sort = document.getElementById('library-sort');
    if (search) search.value = '';
    if (type) type.value = 'all';
    if (status) status.value = 'all';
    if (tag) tag.value = 'all';
    if (sort) sort.value = 'recent';
}

/* ── Tag filter population ───────────────────────────────────────── */

function populateTagFilter(resources) {
    const select = document.getElementById('resource-tag');
    if (!select) return;

    const currentValue = select.value;
    const tags = collectAllTags(resources);

    /* Preserve the "All tags" default, then add one option per tag */
    select.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All tags';
    select.append(allOption);

    tags.forEach((tag) => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        select.append(option);
    });

    /* Restore previous selection if the tag still exists */
    if (tags.includes(currentValue)) {
        select.value = currentValue;
    } else {
        select.value = 'all';
    }
}

/* ── Library rendering ───────────────────────────────────────────── */

function renderLibraryResultCount(filteredCount, totalCount, filtered) {
    const statusBar = document.querySelector('[data-library-status-bar]');
    const countElement = document.querySelector('[data-library-result-count]');
    if (!statusBar || !countElement) return;

    if (totalCount === 0) {
        statusBar.hidden = true;
        return;
    }

    statusBar.hidden = false;

    if (filtered) {
        countElement.textContent = filteredCount === 1
            ? '1 result'
            : filteredCount + ' results';
    } else {
        countElement.textContent = totalCount === 1
            ? '1 resource'
            : totalCount + ' resources';
    }

    /* Show the clear button only when a narrowing filter is active */
    statusBar.querySelectorAll('[data-library-clear-filters]').forEach((button) => {
        button.hidden = !filtered;
    });
}

function renderLibrary() {
    const filters = getLibraryFilters();
    const filtered = applyLibraryFilters(allResources, filters);
    const hasResources = allResources.length > 0;
    const hasResults = filtered.length > 0;
    const activeFilter = isFiltered(filters);

    const emptyState = document.querySelector('[data-library-empty]');
    const noResults = document.querySelector('[data-library-no-results]');
    const list = document.querySelector('[data-library-resource-list]');

    if (!hasResources) {
        /* No resources at all */
        if (emptyState) emptyState.hidden = false;
        if (noResults) noResults.hidden = true;
        if (list) list.hidden = true;
        renderLibraryResultCount(0, 0, false);
    } else if (!hasResults) {
        /* Resources exist but filters match nothing */
        if (emptyState) emptyState.hidden = true;
        if (noResults) noResults.hidden = false;
        if (list) list.hidden = true;
        renderLibraryResultCount(0, allResources.length, true);
    } else {
        /* Show matching results */
        if (emptyState) emptyState.hidden = true;
        if (noResults) noResults.hidden = true;
        if (list) {
            list.replaceChildren(...filtered.map((resource) => createResourceCard(resource)));
            list.hidden = false;
        }
        renderLibraryResultCount(filtered.length, allResources.length, activeFilter);
    }
}

/* ── Event binding ───────────────────────────────────────────────── */

function bindResourceSelection(selector) {
    document.querySelector(selector)?.addEventListener('click', (event) => {
        const openButton = event.target.closest('[data-resource-open]');
        if (openButton) void openResourceViewer(openButton.dataset.resourceOpen);
    });
}

function bindLibraryControls() {
    /* Search: fires on every keystroke and when the input is cleared */
    document.getElementById('library-search')?.addEventListener('input', () => renderLibrary());

    /* Filters and sort */
    document.getElementById('resource-type')?.addEventListener('change', () => renderLibrary());
    document.getElementById('resource-status')?.addEventListener('change', () => renderLibrary());
    document.getElementById('resource-tag')?.addEventListener('change', () => renderLibrary());
    document.getElementById('library-sort')?.addEventListener('change', () => renderLibrary());

    /* Clear filters — any element with the data attribute (status-bar button and no-results button) */
    document.querySelectorAll('[data-library-clear-filters]').forEach((button) => {
        button.addEventListener('click', () => {
            resetLibraryFilters();
            renderLibrary();
        });
    });
}

/* ── Public API ──────────────────────────────────────────────────── */

export async function refreshResourceDisplays() {
    try {
        allResources = await resourceRepository.getAllResources();

        /* Dashboard — always shows 3 most recent, unfiltered */
        renderResourceCollection({
            listSelector: '[data-recent-resources-list]',
            emptySelector: '[data-recent-resources-empty]',
            resources: allResources.slice(0, 3),
            compact: true,
        });

        /* Populate the tag filter from actual resource data */
        populateTagFilter(allResources);

        /* Library — applies current filters */
        renderLibrary();

        await refreshDashboardResourceCount();
    } catch (error) {
        console.error('StudyLens could not refresh resource displays.', error);
        showToast('StudyLens could not load your resources. Please try again.', { variant: 'error' });
    }
}

export async function initResourceList() {
    bindResourceSelection('[data-recent-resources-list]');
    bindResourceSelection('[data-library-resource-list]');
    bindLibraryControls();
    onResourcesChanged(() => {
        void refreshResourceDisplays();
    });
    await refreshResourceDisplays();
}
