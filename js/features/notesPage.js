/**
 * Notes Page UI Controller — Day 15.
 *
 * Renders and manages the Notes workspace:
 * - Reactive note grid rendering with safe DOM text insertion (zero XSS)
 * - Deterministic search and resource filtering
 * - Direct triggers to edit or delete notes
 * - Empty state and no-search-results handling
 */

import { resourceRepository } from '../storage/resourceStore.js';
import { getAllNotes, filterAndSearchNotes } from './noteService.js';
import { onNotesChanged, onResourcesChanged } from '../core/resourceEvents.js';
import { openNoteEditor, openDeleteNoteDialog } from './noteEditor.js';
import { formatResourceDate } from './resourceViewer.js';

let cachedNotes = [];
let cachedResourceMap = new Map();

function getSearchInput() {
    return document.querySelector('[data-notes-search]');
}

function getResourceFilterSelect() {
    return document.querySelector('[data-notes-resource-filter]');
}

function getNotesListContainer() {
    return document.querySelector('[data-notes-list]');
}

function getNotesEmptyState() {
    return document.querySelector('[data-notes-empty]');
}

function getNotesNoResultsState() {
    return document.querySelector('[data-notes-no-results]');
}

function getClearFilterButtons() {
    return document.querySelectorAll('[data-notes-clear-filters]');
}

/**
 * Creates an accessible, safe DOM node for a single Note card.
 * All user content (title, content, tags) is applied via textContent.
 *
 * @param {object} note
 * @param {Map<string, string>} resourceMap - maps resourceId to resource title
 * @returns {HTMLElement}
 */
export function createNoteCard(note, resourceMap) {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.dataset.noteCardId = note.id;

    // Header container
    const header = document.createElement('div');
    header.className = 'note-card-header';

    const titleEl = document.createElement('h2');
    titleEl.className = 'note-card-title';
    titleEl.textContent = note.title;
    header.appendChild(titleEl);

    // Associated resource badge if linked
    if (note.resourceId) {
        const resourceTitle = resourceMap.get(note.resourceId) || 'Linked resource';
        const badge = document.createElement('span');
        badge.className = 'badge note-resource-badge';
        badge.textContent = resourceTitle;
        badge.title = `Linked to: ${resourceTitle}`;
        header.appendChild(badge);
    }

    card.appendChild(header);

    // Content preview
    const previewEl = document.createElement('p');
    previewEl.className = 'note-card-preview';
    previewEl.textContent = note.content;
    card.appendChild(previewEl);

    // Tags list if any
    if (Array.isArray(note.tags) && note.tags.length > 0) {
        const tagList = document.createElement('ul');
        tagList.className = 'resource-tags';
        note.tags.forEach((tag) => {
            const tagItem = document.createElement('li');
            tagItem.className = 'resource-tag';
            tagItem.textContent = tag;
            tagList.appendChild(tagItem);
        });
        card.appendChild(tagList);
    }

    // Card footer with date & action buttons
    const footer = document.createElement('div');
    footer.className = 'note-card-footer';

    const metaRow = document.createElement('div');
    metaRow.className = 'note-card-meta';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'note-card-date';
    dateSpan.textContent = `Updated ${formatResourceDate(note.updatedAt || note.createdAt)}`;
    metaRow.appendChild(dateSpan);

    const actions = document.createElement('div');
    actions.className = 'note-card-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'button button-secondary button-small';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('aria-label', `Edit note: ${note.title}`);
    editBtn.addEventListener('click', () => {
        void openNoteEditor(note);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button button-danger button-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete note: ${note.title}`);
    deleteBtn.addEventListener('click', () => {
        openDeleteNoteDialog(note.id);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    metaRow.appendChild(actions);
    footer.appendChild(metaRow);

    card.appendChild(footer);

    return card;
}

/**
 * Updates the resource filter dropdown with resources currently available.
 * Preserves the currently selected filter value.
 *
 * @param {Array<object>} resources
 */
function updateResourceFilterDropdown(resources) {
    const select = getResourceFilterSelect();
    if (!select) return;

    const previousValue = select.value || 'all';

    // Clear and rebuild options
    select.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All notes';
    select.appendChild(allOption);

    const standaloneOption = document.createElement('option');
    standaloneOption.value = 'standalone';
    standaloneOption.textContent = 'Standalone notes';
    select.appendChild(standaloneOption);

    resources.forEach((res) => {
        const option = document.createElement('option');
        option.value = res.id;
        option.textContent = res.title;
        select.appendChild(option);
    });

    // Restore selection if still valid
    const hasValue = Array.from(select.options).some((opt) => opt.value === previousValue);
    select.value = hasValue ? previousValue : 'all';
}

/**
 * Renders the notes list based on the active query and resource filter.
 */
export function applyNotesFilterAndRender() {
    const searchInput = getSearchInput();
    const filterSelect = getResourceFilterSelect();
    const container = getNotesListContainer();
    const emptyState = getNotesEmptyState();
    const noResultsState = getNotesNoResultsState();

    if (!container || !emptyState || !noResultsState) return;

    const query = searchInput?.value || '';
    const resourceFilter = filterSelect?.value || 'all';
    const isFiltered = Boolean(query.trim() || (resourceFilter && resourceFilter !== 'all'));

    // Toggle clear-filters buttons
    getClearFilterButtons().forEach((btn) => {
        btn.hidden = !isFiltered;
    });

    if (cachedNotes.length === 0) {
        // No notes in DB at all
        container.hidden = true;
        emptyState.hidden = false;
        noResultsState.hidden = true;
        container.replaceChildren();
        return;
    }

    const filtered = filterAndSearchNotes(cachedNotes, {
        query,
        resourceId: resourceFilter,
    });

    if (filtered.length === 0) {
        // Notes exist, but none match current filter
        container.hidden = true;
        emptyState.hidden = true;
        noResultsState.hidden = false;
        container.replaceChildren();
        return;
    }

    // Matching notes found
    container.hidden = false;
    emptyState.hidden = true;
    noResultsState.hidden = true;

    container.replaceChildren();
    filtered.forEach((note) => {
        const card = createNoteCard(note, cachedResourceMap);
        container.appendChild(card);
    });
}

/**
 * Loads notes and resources from repositories and refreshes the Notes view.
 */
export async function refreshNotesPage() {
    try {
        const [notes, resources] = await Promise.all([
            getAllNotes(),
            resourceRepository.getAllResources().catch(() => []),
        ]);

        cachedNotes = notes || [];
        cachedResourceMap = new Map((resources || []).map((r) => [r.id, r.title]));

        updateResourceFilterDropdown(resources || []);
        applyNotesFilterAndRender();
    } catch (err) {
        console.error('StudyLens could not load notes:', err);
    }
}

/**
 * Initializes the Notes page: event listeners and reactive subscriptions.
 */
export function initNotesPage() {
    const searchInput = getSearchInput();
    const filterSelect = getResourceFilterSelect();

    searchInput?.addEventListener('input', () => {
        applyNotesFilterAndRender();
    });

    filterSelect?.addEventListener('change', () => {
        applyNotesFilterAndRender();
    });

    getClearFilterButtons().forEach((btn) => {
        btn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (filterSelect) filterSelect.value = 'all';
            applyNotesFilterAndRender();
        });
    });

    // Reactive subscription to notes changes (created, updated, deleted, cleared)
    onNotesChanged(() => {
        void refreshNotesPage();
    });

    // Reactive subscription to resources changes (resource added, updated, or deleted)
    onResourcesChanged(() => {
        void refreshNotesPage();
    });

    // Initial page load
    void refreshNotesPage();
}
