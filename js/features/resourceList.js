import { onResourcesChanged, onProcessingChanged } from '../core/resourceEvents.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { showToast } from '../ui/toast.js';
import { refreshDashboardResourceCount } from './storageStatus.js';
import { openResourceViewer, openDeleteConfirmation } from './resourceViewer.js';
import { applyLibraryFilters, isFiltered } from '../algorithms/librarySearch.js';
import { collectAllTags } from '../utils/tagUtils.js';
import { getProcessingDisplay } from '../processing/processingDisplay.js';
import { getLiveProcessingJob, retryProcessing, requestProcessing } from './processingService.js';
import {
    getResourceTypePresentation,
    formatFileOrSourceSummary,
    formatResourceDateContext,
    getAllResourceCounts,
} from './resourceMetadata.js';

/* ── Cached resource list and capability counts ──────────────────── */

let allResources = [];
let allCounts = new Map();

/* ── Card rendering helpers ───────────────────────────────────────── */

function createTypeBadge(resource) {
    const { label, toneClass, iconSvg } = getResourceTypePresentation(resource.type);
    const badge = document.createElement('span');
    badge.className = `badge resource-type ${toneClass}`;
    badge.innerHTML = `${iconSvg}<span></span>`;
    badge.querySelector('span').textContent = label;
    return badge;
}

function createMetadata(resource) {
    const display = getProcessingDisplay(resource, { job: getLiveProcessingJob(resource.id) });
    const metadata = document.createElement('div');
    metadata.className = 'resource-card-meta';

    const status = document.createElement('span');
    status.className = 'resource-status';
    status.dataset.status = display.state;
    status.textContent = display.label;

    const date = document.createElement('span');
    date.className = 'resource-date';
    date.textContent = formatResourceDateContext(resource.createdAt, resource.updatedAt);

    metadata.append(status, date);

    const sourceSummary = formatFileOrSourceSummary(resource);
    if (sourceSummary) {
        const sourceSpan = document.createElement('span');
        sourceSpan.className = 'resource-meta-source';
        sourceSpan.textContent = sourceSummary;
        sourceSpan.title = sourceSummary;
        metadata.append(sourceSpan);
    }

    return metadata;
}

function createProcessingNotice(resource) {
    const display = getProcessingDisplay(resource, { job: getLiveProcessingJob(resource.id) });
    if (display.state !== 'failed' && display.state !== 'stalled') return null;

    const notice = document.createElement('div');
    notice.className = 'resource-processing-notice';

    const message = document.createElement('p');
    message.className = 'resource-processing-message';
    message.textContent = display.detail;
    notice.append(message);

    return notice;
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

function createCapabilitiesSection(resource, counts) {
    const section = document.createElement('div');
    section.className = 'resource-card-capabilities';

    const hasAnyOutputs = counts && (
        counts.learningOutputsCount > 0 ||
        counts.flashcardsCount > 0 ||
        counts.quizzesCount > 0 ||
        counts.notesCount > 0
    );

    if (hasAnyOutputs) {
        const pills = [];
        if (counts.learningOutputsCount > 0) {
            pills.push({ label: `${counts.learningOutputsCount} ${counts.learningOutputsCount === 1 ? 'output' : 'outputs'}`, type: 'outputs' });
        }
        if (counts.flashcardsCount > 0) {
            pills.push({ label: `${counts.flashcardsCount} ${counts.flashcardsCount === 1 ? 'card' : 'cards'}`, type: 'flashcards' });
        }
        if (counts.quizzesCount > 0) {
            pills.push({ label: `${counts.quizzesCount} ${counts.quizzesCount === 1 ? 'quiz' : 'quizzes'}`, type: 'quiz' });
        }
        if (counts.notesCount > 0) {
            pills.push({ label: `${counts.notesCount} ${counts.notesCount === 1 ? 'note' : 'notes'}`, type: 'notes' });
        }

        pills.forEach(({ label, type }) => {
            const pill = document.createElement('span');
            pill.className = `capability-pill capability-${type}`;
            pill.textContent = label;
            section.append(pill);
        });
        return section;
    }

    const hint = document.createElement('span');
    hint.className = 'capability-pending-hint';
    if (resource.status === 'completed') {
        hint.textContent = 'Processed • Ready to generate study aids';
    } else if (resource.type === 'video') {
        const hasContent = typeof resource.content === 'string' && resource.content.trim().length > 0;
        hint.textContent = hasContent ? 'Transcript added • Ready to process' : 'No transcript • Paste transcript to generate study aids';
    } else {
        hint.textContent = 'Unprocessed • Process to unlock study aids';
    }
    section.append(hint);
    return section;
}

function createCardActions(resource) {
    const display = getProcessingDisplay(resource, { job: getLiveProcessingJob(resource.id) });
    const actions = document.createElement('div');
    actions.className = 'resource-card-actions';

    if (display.state === 'queued' || display.state === 'processing') {
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'button button-secondary button-small';
        viewBtn.dataset.resourceOpen = resource.id;
        viewBtn.textContent = 'View';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'button button-ghost button-small button-danger';
        deleteBtn.dataset.resourceDelete = resource.id;
        deleteBtn.textContent = 'Delete';

        actions.append(viewBtn, deleteBtn);
        return actions;
    }

    if (display.state === 'failed' || display.state === 'stalled') {
        if (display.canRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'button button-secondary button-small';
            retryBtn.dataset.resourceRetry = resource.id;
            retryBtn.textContent = 'Retry';
            actions.append(retryBtn);
        }

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'button button-secondary button-small';
        openBtn.dataset.resourceOpen = resource.id;
        openBtn.textContent = 'Open';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'button button-ghost button-small button-danger';
        deleteBtn.dataset.resourceDelete = resource.id;
        deleteBtn.textContent = 'Delete';

        actions.append(openBtn, deleteBtn);
        return actions;
    }

    if (resource.status === 'completed') {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'button button-primary button-small';
        openBtn.dataset.resourceOpen = resource.id;
        openBtn.textContent = 'Open';

        const reprocessBtn = document.createElement('button');
        reprocessBtn.type = 'button';
        reprocessBtn.className = 'button button-secondary button-small';
        reprocessBtn.dataset.resourceReprocess = resource.id;
        reprocessBtn.textContent = 'Reprocess';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'button button-ghost button-small button-danger';
        deleteBtn.dataset.resourceDelete = resource.id;
        deleteBtn.textContent = 'Delete';

        actions.append(openBtn, reprocessBtn, deleteBtn);
        return actions;
    }

    // Pending / Unprocessed
    const processBtn = document.createElement('button');
    processBtn.type = 'button';
    processBtn.className = 'button button-primary button-small';
    processBtn.dataset.resourceProcess = resource.id;
    processBtn.textContent = 'Process';

    if (resource.type === 'video' && (!resource.content || !resource.content.trim())) {
        processBtn.disabled = true;
        processBtn.title = 'Paste transcript first before processing';
    }

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'button button-secondary button-small';
    openBtn.dataset.resourceOpen = resource.id;
    openBtn.textContent = 'Open';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button button-ghost button-small button-danger';
    deleteBtn.dataset.resourceDelete = resource.id;
    deleteBtn.textContent = 'Delete';

    actions.append(processBtn, openBtn, deleteBtn);
    return actions;
}

export function createResourceCard(resource, { compact = false, counts = null } = {}) {
    const card = document.createElement('article');
    card.className = compact ? 'resource-card resource-card-compact' : 'resource-card';
    card.dataset.resourceId = resource.id;

    const header = document.createElement('div');
    header.className = 'resource-card-header';

    const heading = document.createElement(compact ? 'h3' : 'h2');
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'resource-card-title';
    openButton.dataset.resourceOpen = resource.id;
    openButton.textContent = resource.title;
    heading.append(openButton);

    const typeBadge = createTypeBadge(resource);
    header.append(heading, typeBadge);

    card.append(header, createMetadata(resource));

    const notice = createProcessingNotice(resource);
    if (notice) card.append(notice);

    if (resource.tags && resource.tags.length) {
        card.append(createTags(resource.tags));
    }

    if (!compact) {
        const itemCounts = counts || allCounts.get(resource.id) || null;
        card.append(createCapabilitiesSection(resource, itemCounts));
        card.append(createCardActions(resource));
    }

    return card;
}

/* ── Dashboard rendering ─────────────────────────────────────────── */

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

function updateNoResultsMessage(noResultsEl, filters) {
    const h2 = noResultsEl.querySelector('h2');
    const p = noResultsEl.querySelector('p');
    if (!h2 || !p) return;

    if (filters.query && filters.query.trim()) {
        h2.textContent = 'No matching resources';
        p.textContent = `No resources match "${filters.query.trim()}". Try checking for spelling errors or clear filters.`;
        return;
    }

    if (filters.type !== 'all' && filters.status === 'all' && filters.tag === 'all') {
        const typeNames = { pdf: 'PDF', image: 'Image', video: 'Video', text: 'Text' };
        const label = typeNames[filters.type] || filters.type;
        h2.textContent = `No ${label} resources yet`;
        p.textContent = `You haven't added any ${label} resources to your library yet.`;
        return;
    }

    if (filters.status !== 'all' && filters.type === 'all' && filters.tag === 'all') {
        const statusLabels = {
            pending: 'pending',
            queued: 'queued',
            processing: 'currently processing',
            completed: 'completed',
            failed: 'failed',
        };
        const label = statusLabels[filters.status] || filters.status;
        h2.textContent = `No ${filters.status} resources`;
        p.textContent = `There are no resources currently ${label}.`;
        return;
    }

    if (filters.tag !== 'all' && filters.type === 'all' && filters.status === 'all') {
        h2.textContent = `No resources with tag "${filters.tag}"`;
        p.textContent = `There are no resources matching the selected tag.`;
        return;
    }

    h2.textContent = 'No matching resources';
    p.textContent = 'Try adjusting your search or filters to find what you are looking for.';
}

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
        countElement.textContent = `Showing ${filteredCount} of ${totalCount} resource${totalCount === 1 ? '' : 's'}`;
    } else {
        countElement.textContent = totalCount === 1
            ? '1 resource'
            : `${totalCount} resources`;
    }

    /* Show the clear button only when a narrowing filter is active */
    statusBar.querySelectorAll('[data-library-clear-filters]').forEach((button) => {
        button.hidden = !filtered;
    });
}

function renderLibrary() {
    const filters = getLibraryFilters();
    const getEffectiveStatus = (res) => {
        const job = getLiveProcessingJob(res.id);
        return getProcessingDisplay(res, { job }).state;
    };
    const filtered = applyLibraryFilters(allResources, filters, getEffectiveStatus);
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
        if (noResults) {
            updateNoResultsMessage(noResults, filters);
            noResults.hidden = false;
        }
        if (list) list.hidden = true;
        renderLibraryResultCount(0, allResources.length, true);
    } else {
        /* Show matching results */
        if (emptyState) emptyState.hidden = true;
        if (noResults) noResults.hidden = true;
        if (list) {
            list.replaceChildren(...filtered.map((resource) => createResourceCard(resource, { counts: allCounts.get(resource.id) })));
            list.hidden = false;
        }
        renderLibraryResultCount(filtered.length, allResources.length, activeFilter);
    }
}

/* ── Processing action handling ──────────────────────────────────── */

async function handleProcessingAction(resourceId, actionType) {
    try {
        let request;
        if (actionType === 'retry') {
            request = await retryProcessing(resourceId);
            if (!request.accepted && !request.deduplicated) {
                if (request.reason === 'RETRY_LIMIT_REACHED') {
                    showToast('Retry limit reached for this resource.', { variant: 'error' });
                } else if (request.reason === 'NON_RETRYABLE') {
                    showToast('This failure cannot be fixed by retrying.', { variant: 'error' });
                } else {
                    showToast('This resource cannot be retried right now.', { variant: 'error' });
                }
                return;
            }
        } else {
            request = await requestProcessing(resourceId, {
                reason: actionType === 'reprocess' ? 'reprocess' : 'requested',
            });
        }

        if (request.deduplicated) {
            showToast('This resource is already queued or being processed.');
            return;
        }

        showToast(actionType === 'reprocess' ? 'Reprocessing queued…' : 'Processing queued…');
        const job = await request.completion;
        if (job?.status === 'completed') {
            showToast('Processing completed successfully.');
        } else if (job?.status === 'failed') {
            showToast(`Processing failed: ${job.errorMessage || 'Please try again.'}`, { variant: 'error' });
        }
    } catch (error) {
        console.error('StudyLens could not process resource.', error);
        showToast('StudyLens could not start processing. Please try again.', { variant: 'error' });
    }
}

/* ── Event binding ───────────────────────────────────────────────── */

function bindResourceSelection(selector) {
    document.querySelector(selector)?.addEventListener('click', (event) => {
        const deleteButton = event.target.closest('[data-resource-delete]');
        if (deleteButton) {
            openDeleteConfirmation(deleteButton.dataset.resourceDelete);
            return;
        }

        const retryButton = event.target.closest('[data-resource-retry]');
        if (retryButton) {
            retryButton.disabled = true;
            void handleProcessingAction(retryButton.dataset.resourceRetry, 'retry');
            return;
        }

        const processButton = event.target.closest('[data-resource-process]');
        if (processButton) {
            processButton.disabled = true;
            void handleProcessingAction(processButton.dataset.resourceProcess, 'process');
            return;
        }

        const reprocessButton = event.target.closest('[data-resource-reprocess]');
        if (reprocessButton) {
            reprocessButton.disabled = true;
            void handleProcessingAction(reprocessButton.dataset.resourceReprocess, 'reprocess');
            return;
        }

        const openButton = event.target.closest('[data-resource-open]');
        if (openButton) {
            void openResourceViewer(openButton.dataset.resourceOpen);
        }
    });
}

let processingRefreshScheduled = false;

/** Coalesce bursts of processing events into one re-render. */
function scheduleProcessingRefresh() {
    if (processingRefreshScheduled) return;
    processingRefreshScheduled = true;
    Promise.resolve().then(() => {
        processingRefreshScheduled = false;
        void refreshResourceDisplays();
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

        try {
            allCounts = await getAllResourceCounts(allResources);
        } catch (countsErr) {
            console.warn('StudyLens could not batch load capability counts.', countsErr);
            allCounts = new Map();
        }

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
    onProcessingChanged(scheduleProcessingRefresh);
    await refreshResourceDisplays();
}
