/**
 * Flashcard Interactive Study Viewer — Day 12.
 *
 * Provides a modal study session for flashcards:
 * - Flip between front (question/prompt) and back (answer/explanation)
 * - Next / Previous navigation with progress tracking (e.g. "Card 1 of 10")
 * - Progress bar indicating completion percentage
 * - Keyboard interaction: Space/Enter to flip, Arrow keys to navigate, Escape to close
 * - Safe text rendering (textContent only)
 * - Source chunk traceability badge display
 */

import { openDialog, closeDialog } from '../ui/modal.js';
import { formatSourceChunks } from './learningOutputView.js';

let cards = [];
let currentIndex = 0;
let isFlipped = false;
let keydownListenerActive = false;

function viewerDialog() {
    return document.getElementById('flashcard-viewer-dialog');
}

function updateProgress() {
    const total = cards.length;
    const current = total === 0 ? 0 : currentIndex + 1;

    const counter = document.querySelector('[data-flashcard-counter]');
    if (counter) {
        counter.textContent = `Card ${current} of ${total}`;
    }

    const progressBar = document.querySelector('[data-flashcard-progress-bar]');
    if (progressBar) {
        const pct = total === 0 ? 0 : Math.round((current / total) * 100);
        progressBar.style.width = `${pct}%`;
    }

    const prevBtn = document.querySelector('[data-flashcard-prev]');
    if (prevBtn) {
        prevBtn.disabled = currentIndex <= 0;
    }

    const nextBtn = document.querySelector('[data-flashcard-next]');
    if (nextBtn) {
        nextBtn.disabled = currentIndex >= total - 1;
    }
}

function updateCardContent() {
    if (!cards.length || currentIndex < 0 || currentIndex >= cards.length) {
        return;
    }

    const card = cards[currentIndex];
    const frontEl = document.querySelector('[data-flashcard-front]');
    const backEl = document.querySelector('[data-flashcard-back]');
    const cardEl = document.querySelector('[data-flashcard-card]');
    const sourceBadge = document.querySelector('[data-flashcard-source-badge]');

    // Always reset flip state when showing a new card
    isFlipped = false;
    if (cardEl) {
        cardEl.classList.remove('is-flipped');
        cardEl.setAttribute('aria-expanded', 'false');
    }

    const content = card.content;
    const frontText = typeof content === 'object' && content ? content.front : String(content ?? '');
    const backText = typeof content === 'object' && content ? content.back : '';

    if (frontEl) frontEl.textContent = frontText;
    if (backEl) backEl.textContent = backText;

    if (sourceBadge) {
        const chunkText = formatSourceChunks(card.sourceChunkIds);
        if (chunkText) {
            sourceBadge.textContent = chunkText;
            sourceBadge.title = `Grounded in source ${chunkText}`;
            sourceBadge.hidden = false;
        } else {
            sourceBadge.textContent = '';
            sourceBadge.hidden = true;
        }
    }

    updateProgress();
}

export function flipCard() {
    const cardEl = document.querySelector('[data-flashcard-card]');
    if (!cardEl) return;

    isFlipped = !isFlipped;
    cardEl.classList.toggle('is-flipped', isFlipped);
    cardEl.setAttribute('aria-expanded', String(isFlipped));
}

export function nextCard() {
    if (currentIndex < cards.length - 1) {
        currentIndex++;
        updateCardContent();
    }
}

export function prevCard() {
    if (currentIndex > 0) {
        currentIndex--;
        updateCardContent();
    }
}

function handleKeydown(event) {
    const dialog = viewerDialog();
    if (!dialog || !dialog.open) return;

    // Do not interfere if user is typing into an input/textarea
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        flipCard();
    } else if (event.key === 'ArrowRight' || event.key === 'Right') {
        event.preventDefault();
        nextCard();
    } else if (event.key === 'ArrowLeft' || event.key === 'Left') {
        event.preventDefault();
        prevCard();
    }
}

export function openFlashcardViewer(flashcards, deckTitle = 'Flashcard Deck') {
    if (!Array.isArray(flashcards) || flashcards.length === 0) {
        return;
    }

    cards = flashcards;
    currentIndex = 0;
    isFlipped = false;

    const titleEl = document.querySelector('[data-flashcard-deck-title]');
    if (titleEl) {
        titleEl.textContent = deckTitle;
    }

    updateCardContent();

    const dialog = viewerDialog();
    if (dialog) {
        openDialog(dialog);
        // Focus the card for immediate keyboard accessibility
        document.querySelector('[data-flashcard-card]')?.focus();
    }

    if (!keydownListenerActive) {
        document.addEventListener('keydown', handleKeydown);
        keydownListenerActive = true;
    }
}

export function initFlashcardViewer() {
    const dialog = viewerDialog();
    if (!dialog) return;

    // Flip button & clicking card flips
    document.querySelector('[data-flashcard-flip]')?.addEventListener('click', () => {
        flipCard();
    });

    document.querySelector('[data-flashcard-card]')?.addEventListener('click', () => {
        flipCard();
    });

    // Navigation buttons
    document.querySelector('[data-flashcard-prev]')?.addEventListener('click', () => {
        prevCard();
    });

    document.querySelector('[data-flashcard-next]')?.addEventListener('click', () => {
        nextCard();
    });

    // Dialog close cleanup
    dialog.addEventListener('close', () => {
        if (keydownListenerActive) {
            document.removeEventListener('keydown', handleKeydown);
            keydownListenerActive = false;
        }
    });
}
