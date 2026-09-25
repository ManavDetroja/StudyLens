/**
 * Learning Output View Module — Day 11.
 *
 * Renders structured study aids (Summary, Key Concepts, Definitions, Questions)
 * into the Resource Viewer modal using safe DOM methods (textContent only).
 *
 * Provides dedicated rendering for:
 * - Empty states (no outputs, empty resource content)
 * - Loading / processing states
 * - Error states
 * - Categorized output sections with source traceability badges
 */

/**
 * Format source chunk IDs into a human-friendly label.
 * e.g. [0] -> "Chunk 1", [0, 2] -> "Chunks 1, 3", ["chunk-1"] -> "Chunk 1"
 *
 * @param {Array<string|number>} [chunkIds]
 * @returns {string}
 */
export function formatSourceChunks(chunkIds) {
    if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
        return '';
    }

    const parsed = chunkIds.map((id) => {
        if (typeof id === 'number') return id + 1;
        const str = String(id).trim();
        const match = str.match(/^chunk[-_]?(\d+)$/i);
        if (match) return parseInt(match[1], 10) + 1;
        return str;
    });

    const unique = [...new Set(parsed)];
    const allNumbers = unique.every((n) => typeof n === 'number');

    if (allNumbers) {
        return unique.length === 1 ? `Chunk ${unique[0]}` : `Chunks ${unique.join(', ')}`;
    }

    return unique.length === 1 ? `Chunk ${unique[0]}` : `Chunks ${unique.join(', ')}`;
}

/**
 * Create a source traceability badge element.
 *
 * @param {Array<string|number>} [chunkIds]
 * @returns {HTMLElement|null}
 */
function createSourceBadge(chunkIds) {
    const text = formatSourceChunks(chunkIds);
    if (!text) return null;

    const badge = document.createElement('span');
    badge.className = 'source-trace-badge';
    badge.textContent = text;
    badge.title = `Grounded in source ${text}`;
    return badge;
}

/**
 * Render the Extractive Summary section.
 *
 * @param {object} summaryOutput
 * @returns {HTMLElement}
 */
export function renderSummarySection(summaryOutput) {
    const card = document.createElement('article');
    card.className = 'learning-output-card output-summary-card';
    card.dataset.outputType = 'summary';
    if (summaryOutput.id) card.dataset.outputId = summaryOutput.id;

    const header = document.createElement('div');
    header.className = 'output-section-header';

    const heading = document.createElement('h4');
    heading.textContent = 'Summary';
    header.append(heading);

    const badge = createSourceBadge(summaryOutput.sourceChunkIds);
    if (badge) header.append(badge);

    card.append(header);

    const paragraph = document.createElement('p');
    paragraph.className = 'output-summary-text';
    paragraph.textContent = typeof summaryOutput.content === 'string'
        ? summaryOutput.content
        : String(summaryOutput.content ?? '');
    card.append(paragraph);

    return card;
}

/**
 * Render the Key Concepts section.
 *
 * @param {Array<object>} conceptOutputs
 * @returns {HTMLElement}
 */
export function renderConceptsSection(conceptOutputs) {
    const card = document.createElement('article');
    card.className = 'learning-output-card output-concepts-card';
    card.dataset.outputType = 'concept';

    const header = document.createElement('div');
    header.className = 'output-section-header';

    const heading = document.createElement('h4');
    heading.textContent = `Key Concepts (${conceptOutputs.length})`;
    header.append(heading);

    card.append(header);

    const list = document.createElement('ul');
    list.className = 'concepts-list';

    conceptOutputs.forEach((concept) => {
        const item = document.createElement('li');
        item.className = 'concept-chip';
        if (concept.id) item.dataset.outputId = concept.id;
        if (concept.sourceChunkIds?.length) {
            item.dataset.sourceChunkIds = concept.sourceChunkIds.join(',');
        }

        const term = document.createElement('span');
        term.className = 'concept-term';
        term.textContent = concept.metadata?.term ?? concept.content;
        item.append(term);

        if (typeof concept.metadata?.score === 'number' && concept.metadata.score > 1) {
            const score = document.createElement('span');
            score.className = 'concept-score';
            score.textContent = `×${concept.metadata.score}`;
            item.append(score);
        }

        const badge = createSourceBadge(concept.sourceChunkIds);
        if (badge) item.append(badge);

        list.append(item);
    });

    card.append(list);
    return card;
}

/**
 * Render the Definitions section.
 *
 * @param {Array<object>} definitionOutputs
 * @returns {HTMLElement}
 */
export function renderDefinitionsSection(definitionOutputs) {
    const card = document.createElement('article');
    card.className = 'learning-output-card output-definitions-card';
    card.dataset.outputType = 'definition';

    const header = document.createElement('div');
    header.className = 'output-section-header';

    const heading = document.createElement('h4');
    heading.textContent = `Definitions (${definitionOutputs.length})`;
    header.append(heading);

    card.append(header);

    const list = document.createElement('div');
    list.className = 'definitions-list';

    definitionOutputs.forEach((def) => {
        const item = document.createElement('div');
        item.className = 'definition-card';
        if (def.id) item.dataset.outputId = def.id;
        if (def.sourceChunkIds?.length) {
            item.dataset.sourceChunkIds = def.sourceChunkIds.join(',');
        }

        const defHeader = document.createElement('div');
        defHeader.className = 'definition-card-header';

        const termEl = document.createElement('span');
        termEl.className = 'definition-term';
        termEl.textContent = def.metadata?.term ?? def.content.split(':')[0] ?? 'Term';
        defHeader.append(termEl);

        const badge = createSourceBadge(def.sourceChunkIds);
        if (badge) defHeader.append(badge);

        item.append(defHeader);

        const descEl = document.createElement('p');
        descEl.className = 'definition-desc';
        let descText = def.metadata?.definition;
        if (!descText && typeof def.content === 'string') {
            const colonIdx = def.content.indexOf(':');
            descText = colonIdx !== -1 ? def.content.slice(colonIdx + 1).trim() : def.content;
        }
        descEl.textContent = descText || '';
        item.append(descEl);

        list.append(item);
    });

    card.append(list);
    return card;
}

/**
 * Render the Study Questions section.
 *
 * @param {Array<object>} questionOutputs
 * @returns {HTMLElement}
 */
export function renderQuestionsSection(questionOutputs) {
    const card = document.createElement('article');
    card.className = 'learning-output-card output-questions-card';
    card.dataset.outputType = 'question';

    const header = document.createElement('div');
    header.className = 'output-section-header';

    const heading = document.createElement('h4');
    heading.textContent = `Study Questions (${questionOutputs.length})`;
    header.append(heading);

    card.append(header);

    const list = document.createElement('ol');
    list.className = 'questions-list';

    questionOutputs.forEach((q) => {
        const item = document.createElement('li');
        item.className = 'question-item';
        if (q.id) item.dataset.outputId = q.id;
        if (q.sourceChunkIds?.length) {
            item.dataset.sourceChunkIds = q.sourceChunkIds.join(',');
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'question-item-content';

        const text = document.createElement('span');
        text.className = 'question-text';
        text.textContent = q.content;
        contentWrapper.append(text);

        const badge = createSourceBadge(q.sourceChunkIds);
        if (badge) contentWrapper.append(badge);

        item.append(contentWrapper);
        list.append(item);
    });

    card.append(list);
    return card;
}

/**
 * Render the Flashcards preview section.
 *
 * @param {Array<object>} flashcardOutputs
 * @param {Function} [onStudyClick]
 * @returns {HTMLElement}
 */
export function renderFlashcardsSection(flashcardOutputs, onStudyClick) {
    const card = document.createElement('article');
    card.className = 'learning-output-card output-flashcards-card';
    card.dataset.outputType = 'flashcard';

    const header = document.createElement('div');
    header.className = 'output-section-header';

    const heading = document.createElement('h4');
    heading.textContent = `Flashcards (${flashcardOutputs.length})`;
    header.append(heading);

    if (onStudyClick) {
        const studyBtn = document.createElement('button');
        studyBtn.className = 'button button-secondary';
        studyBtn.style.minHeight = '1.9rem';
        studyBtn.style.padding = '0.2rem 0.65rem';
        studyBtn.style.fontSize = '0.78rem';
        studyBtn.type = 'button';
        studyBtn.textContent = 'Study deck';
        studyBtn.dataset.studyFlashcardsBtn = '';
        studyBtn.addEventListener('click', onStudyClick);
        header.append(studyBtn);
    }

    card.append(header);

    const list = document.createElement('div');
    list.className = 'flashcard-preview-list';

    flashcardOutputs.slice(0, 4).forEach((fc) => {
        const item = document.createElement('div');
        item.className = 'flashcard-preview-item';

        const front = document.createElement('span');
        front.className = 'flashcard-preview-front';
        const frontText = typeof fc.content === 'object' && fc.content ? fc.content.front : String(fc.content ?? '');
        front.textContent = frontText;
        item.append(front);

        const badge = createSourceBadge(fc.sourceChunkIds);
        if (badge) item.append(badge);

        list.append(item);
    });

    if (flashcardOutputs.length > 4) {
        const more = document.createElement('p');
        more.className = 'form-helper';
        more.textContent = `+ ${flashcardOutputs.length - 4} more flashcard${flashcardOutputs.length - 4 === 1 ? '' : 's'}`;
        list.append(more);
    }

    card.append(list);
    return card;
}

/**
 * Render an empty state view.
 *
 * @param {string} [message]
 * @returns {HTMLElement}
 */
export function renderEmptyState(message = 'No learning outputs generated yet. Click "Generate learning outputs" below to create study aids.') {
    const container = document.createElement('div');
    container.className = 'learning-outputs-empty';

    const text = document.createElement('p');
    text.className = 'form-helper';
    text.textContent = message;
    container.append(text);

    return container;
}

/**
 * Render a loading/processing state view.
 *
 * @param {string} [message]
 * @returns {HTMLElement}
 */
export function renderLoadingState(message = 'Analyzing content and generating study aids…') {
    const container = document.createElement('div');
    container.className = 'learning-outputs-loading';

    const spinner = document.createElement('div');
    spinner.className = 'learning-outputs-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.className = 'form-helper';
    text.textContent = message;

    container.append(spinner, text);
    return container;
}

/**
 * Render an error state view.
 *
 * @param {string} [message]
 * @returns {HTMLElement}
 */
export function renderErrorState(message = 'Could not generate learning outputs. Please try again.') {
    const container = document.createElement('div');
    container.className = 'learning-outputs-error';

    const text = document.createElement('p');
    text.className = 'form-error';
    text.textContent = message;
    text.setAttribute('role', 'alert');
    container.append(text);

    return container;
}

/**
 * Main render function for Learning Outputs inside the Resource Viewer.
 *
 * @param {HTMLElement} container
 * @param {object} state
 * @param {string} state.status — 'ready' | 'empty' | 'loading' | 'error'
 * @param {Array<object>} [state.outputs]
 * @param {string} [state.errorMessage]
 * @param {string} [state.emptyMessage]
 */
export function renderLearningOutputs(container, state = {}) {
    if (!container) return;

    container.replaceChildren();

    const status = state.status ?? 'empty';

    if (status === 'loading') {
        container.append(renderLoadingState(state.loadingMessage));
        return;
    }

    if (status === 'error') {
        container.append(renderErrorState(state.errorMessage));
        return;
    }

    const outputs = Array.isArray(state.outputs) ? state.outputs : [];

    if (status === 'empty' || outputs.length === 0) {
        container.append(renderEmptyState(state.emptyMessage));
        return;
    }

    // Group outputs by type
    const summaryOutput = outputs.find((o) => o.type === 'summary');
    const concepts = outputs.filter((o) => o.type === 'concept');
    const definitions = outputs.filter((o) => o.type === 'definition');
    const questions = outputs.filter((o) => o.type === 'question');
    const flashcards = outputs.filter((o) => o.type === 'flashcard');

    const wrapper = document.createElement('div');
    wrapper.className = 'learning-outputs-section';

    if (summaryOutput) {
        wrapper.append(renderSummarySection(summaryOutput));
    }

    if (concepts.length > 0) {
        wrapper.append(renderConceptsSection(concepts));
    }

    if (definitions.length > 0) {
        wrapper.append(renderDefinitionsSection(definitions));
    }

    if (questions.length > 0) {
        wrapper.append(renderQuestionsSection(questions));
    }

    if (flashcards.length > 0) {
        wrapper.append(renderFlashcardsSection(flashcards, state.onStudyFlashcards));
    }

    container.append(wrapper);
}
