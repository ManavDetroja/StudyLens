/**
 * Flashcards Page Feature Module — Day 12.
 *
 * Manages the Flashcards main section (#flashcards):
 * - Displays available flashcard decks grouped by source resource
 * - Shows card count, source title, and "Study deck" trigger
 * - Renders friendly empty state when no flashcards exist with guidance to generate from Library
 * - Reactively refreshes decks when learning outputs or resources change
 * - Launches the Flashcard Interactive Viewer for study sessions
 */

import { getFlashcardDecks } from './flashcardService.js';
import { openFlashcardViewer } from './flashcardViewer.js';
import { onLearningOutputsChanged, onResourcesChanged } from '../core/resourceEvents.js';

let activeDecks = [];

/**
 * Creates a DOM card for a single flashcard deck.
 *
 * @param {object} deck — { resourceId, title, flashcards, count }
 * @returns {HTMLElement}
 */
export function createDeckCard(deck) {
    const card = document.createElement('article');
    card.className = 'card flashcard-deck-card';
    card.dataset.deckResourceId = deck.resourceId;

    const header = document.createElement('div');
    header.className = 'flashcard-deck-header';

    const title = document.createElement('h2');
    title.className = 'flashcard-deck-title';
    title.textContent = deck.title;
    header.append(title);

    const badge = document.createElement('span');
    badge.className = 'badge flashcard-deck-badge';
    badge.textContent = `${deck.count} card${deck.count === 1 ? '' : 's'}`;
    header.append(badge);

    card.append(header);

    // Preview snippet of the first card if available
    if (deck.flashcards.length > 0) {
        const firstCard = deck.flashcards[0];
        const previewPrompt = document.createElement('p');
        previewPrompt.className = 'flashcard-deck-preview';
        const frontText = typeof firstCard.content === 'object' && firstCard.content
            ? firstCard.content.front
            : String(firstCard.content ?? '');
        previewPrompt.textContent = `Sample: "${frontText}"`;
        card.append(previewPrompt);
    }

    const actions = document.createElement('div');
    actions.className = 'flashcard-deck-actions';

    const studyBtn = document.createElement('button');
    studyBtn.className = 'button button-primary';
    studyBtn.type = 'button';
    studyBtn.textContent = 'Study deck';
    studyBtn.dataset.studyDeck = deck.resourceId;
    studyBtn.addEventListener('click', () => {
        openFlashcardViewer(deck.flashcards, deck.title);
    });

    actions.append(studyBtn);
    card.append(actions);

    return card;
}

/**
 * Renders deck cards or empty state into the Flashcards page container.
 *
 * @param {Array<object>} decks
 */
export function renderFlashcardDecks(decks) {
    const emptyEl = document.querySelector('[data-flashcards-empty]');
    const decksContainer = document.querySelector('[data-flashcards-decks]');

    if (!emptyEl || !decksContainer) return;

    activeDecks = decks;

    if (!decks || decks.length === 0) {
        emptyEl.hidden = false;
        decksContainer.hidden = true;
        decksContainer.replaceChildren();
        return;
    }

    emptyEl.hidden = true;
    decksContainer.hidden = false;
    decksContainer.replaceChildren();

    decks.forEach((deck) => {
        decksContainer.append(createDeckCard(deck));
    });
}

/**
 * Loads decks from storage and renders them.
 */
export async function loadFlashcardDecks() {
    try {
        const decks = await getFlashcardDecks();
        renderFlashcardDecks(decks);
    } catch (err) {
        console.error('StudyLens could not load flashcard decks.', err);
    }
}

/**
 * Initializes the Flashcards page event listeners and initial load.
 */
export function initFlashcardPage() {
    // Navigation to library from empty state or header button
    document.querySelectorAll('[data-flashcards-go-library]').forEach((btn) => {
        btn.addEventListener('click', () => {
            window.location.hash = '#library';
        });
    });

    // Reactive reload on storage events
    onLearningOutputsChanged(() => {
        void loadFlashcardDecks();
    });

    onResourcesChanged(() => {
        void loadFlashcardDecks();
    });

    // Reload when navigating to the flashcards page
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#flashcards') {
            void loadFlashcardDecks();
        }
    });

    // Initial load
    void loadFlashcardDecks();
}
