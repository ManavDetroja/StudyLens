import { notifyResourcesChanged } from '../core/resourceEvents.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { learningOutputRepository } from '../storage/learningOutputStore.js';
import { closeDialog, openDialog } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { openTextResourceForm } from './resourceForm.js';
import { deleteProcessedContent, getProcessedContent } from './processingIntegration.js';
import {
    generateLearningOutputsForResource,
    getLearningOutputsSummaryForResource,
} from './learningOutputService.js';
import {
    generateFlashcardsForResource,
    getFlashcardsForResource,
} from './flashcardService.js';
import { openFlashcardViewer } from './flashcardViewer.js';
import { renderLearningOutputs } from './learningOutputView.js';

let activeResource = null;
let pendingDeleteId = null;
let isGenerating = false;
let isGeneratingFlashcards = false;

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

function renderResource(resource, processed = null, outputsSummary = null) {
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

    /* Learning outputs UI & summary indicator — Day 11 */
    const outputsSection = document.querySelector('[data-resource-viewer-outputs-section]');
    const outputsSummaryElement = document.querySelector('[data-resource-viewer-outputs-summary]');
    const outputsBadge = document.querySelector('[data-resource-viewer-outputs-badge]');
    const outputsContainer = document.querySelector('[data-resource-viewer-outputs-container]');
    const generateBtn = document.querySelector('[data-resource-viewer-generate]');

    const hasContent = typeof resource.content === 'string' && resource.content.trim().length > 0;
    const hasOutputs = Boolean(outputsSummary && outputsSummary.hasOutputs);

    if (outputsBadge) {
        if (hasOutputs && outputsSummary.total > 0) {
            outputsBadge.textContent = `${outputsSummary.total} item${outputsSummary.total === 1 ? '' : 's'}`;
            outputsBadge.hidden = false;
        } else {
            outputsBadge.textContent = '';
            outputsBadge.hidden = true;
        }
    }

    if (outputsSummaryElement) {
        if (hasOutputs) {
            const parts = [];
            if (outputsSummary.counts.summary > 0) parts.push('Summary available');
            if (outputsSummary.counts.concept > 0) {
                parts.push(`${outputsSummary.counts.concept} concept${outputsSummary.counts.concept === 1 ? '' : 's'}`);
            }
            if (outputsSummary.counts.definition > 0) {
                parts.push(`${outputsSummary.counts.definition} definition${outputsSummary.counts.definition === 1 ? '' : 's'}`);
            }
            if (outputsSummary.counts.question > 0) {
                parts.push(`${outputsSummary.counts.question} question${outputsSummary.counts.question === 1 ? '' : 's'}`);
            }
            if (outputsSummary.counts.flashcard > 0) {
                parts.push(`${outputsSummary.counts.flashcard} flashcard${outputsSummary.counts.flashcard === 1 ? '' : 's'}`);
            }
            outputsSummaryElement.textContent = parts.join(' • ');
            outputsSummaryElement.hidden = false;
        } else {
            outputsSummaryElement.textContent = '';
            outputsSummaryElement.hidden = true;
        }
    }

    if (generateBtn) {
        if (!hasContent) {
            generateBtn.disabled = true;
            generateBtn.title = 'Add text content to generate learning outputs';
            generateBtn.textContent = 'Generate learning outputs';
        } else {
            generateBtn.disabled = false;
            generateBtn.removeAttribute('title');
            generateBtn.textContent = hasOutputs ? 'Regenerate learning outputs' : 'Generate learning outputs';
        }
    }

    const generateFlashcardsBtn = document.querySelector('[data-resource-viewer-generate-flashcards]');
    const hasFlashcards = Boolean(outputsSummary && outputsSummary.counts && outputsSummary.counts.flashcard > 0);

    if (generateFlashcardsBtn) {
        if (!hasContent) {
            generateFlashcardsBtn.disabled = true;
            generateFlashcardsBtn.title = 'Add text content to generate flashcards';
            generateFlashcardsBtn.textContent = 'Generate flashcards';
        } else {
            generateFlashcardsBtn.disabled = false;
            generateFlashcardsBtn.removeAttribute('title');
            generateFlashcardsBtn.textContent = hasFlashcards ? 'Regenerate flashcards' : 'Generate flashcards';
        }
    }

    if (outputsContainer) {
        if (!hasContent) {
            renderLearningOutputs(outputsContainer, {
                status: 'empty',
                emptyMessage: 'This resource has no text content. Add content to generate learning outputs.',
            });
        } else if (hasOutputs) {
            renderLearningOutputs(outputsContainer, {
                status: 'ready',
                outputs: outputsSummary.outputs,
                onStudyFlashcards: () => {
                    const cards = outputsSummary.outputs.filter((o) => o.type === 'flashcard');
                    if (cards.length > 0) {
                        openFlashcardViewer(cards, resource.title);
                    }
                },
            });
        } else {
            renderLearningOutputs(outputsContainer, {
                status: 'empty',
                emptyMessage: 'No learning outputs generated yet. Click "Generate learning outputs" below to create study aids.',
            });
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

        let outputsSummary = null;
        try {
            outputsSummary = await getLearningOutputsSummaryForResource(resourceId);
        } catch {
            // Learning outputs are an enhancement; proceed if unavailable
        }

        activeResource = resource;
        renderResource(resource, processed, outputsSummary);
        openDialog(viewerDialog());
    } catch (error) {
        console.error('StudyLens could not open the resource.', error);
        showToast('StudyLens could not open this resource. Please try again.', { variant: 'error' });
    }
}

export function initResourceViewer() {
    document.querySelector('[data-resource-viewer-generate]')?.addEventListener('click', async (event) => {
        if (isGenerating || !activeResource) return;

        const hasContent = typeof activeResource.content === 'string' && activeResource.content.trim().length > 0;
        if (!hasContent) {
            showToast('Cannot generate learning outputs for empty content.', { variant: 'error' });
            return;
        }

        const btn = event.currentTarget;
        const outputsContainer = document.querySelector('[data-resource-viewer-outputs-container]');
        const wasRegenerate = btn.textContent.toLowerCase().includes('regenerate');

        isGenerating = true;
        btn.disabled = true;
        btn.textContent = 'Generating…';

        if (outputsContainer) {
            renderLearningOutputs(outputsContainer, { status: 'loading' });
        }

        try {
            await generateLearningOutputsForResource(activeResource.id);
            const [processed, summary] = await Promise.all([
                getProcessedContent(activeResource.id).catch(() => null),
                getLearningOutputsSummaryForResource(activeResource.id).catch(() => null),
            ]);
            renderResource(activeResource, processed, summary);
            showToast(wasRegenerate ? 'Learning outputs regenerated.' : 'Learning outputs generated.');
        } catch (err) {
            console.error('StudyLens could not generate learning outputs.', err);
            if (outputsContainer) {
                renderLearningOutputs(outputsContainer, {
                    status: 'error',
                    errorMessage: 'Could not generate learning outputs: ' + (err.message || 'Please try again.'),
                });
            }
            btn.disabled = false;
            btn.textContent = wasRegenerate ? 'Regenerate learning outputs' : 'Generate learning outputs';
            showToast('Could not generate learning outputs: ' + (err.message || 'Please try again.'), { variant: 'error' });
        } finally {
            isGenerating = false;
        }
    });

    document.querySelector('[data-resource-viewer-generate-flashcards]')?.addEventListener('click', async (event) => {
        if (isGeneratingFlashcards || !activeResource) return;

        const hasContent = typeof activeResource.content === 'string' && activeResource.content.trim().length > 0;
        if (!hasContent) {
            showToast('Cannot generate flashcards for empty content.', { variant: 'error' });
            return;
        }

        const btn = event.currentTarget;
        const wasRegenerate = btn.textContent.toLowerCase().includes('regenerate');

        isGeneratingFlashcards = true;
        btn.disabled = true;
        btn.textContent = 'Generating…';

        try {
            await generateFlashcardsForResource(activeResource.id);
            const [processed, summary] = await Promise.all([
                getProcessedContent(activeResource.id).catch(() => null),
                getLearningOutputsSummaryForResource(activeResource.id).catch(() => null),
            ]);
            renderResource(activeResource, processed, summary);
            showToast(wasRegenerate ? 'Flashcards regenerated.' : 'Flashcards generated.');
        } catch (err) {
            console.error('StudyLens could not generate flashcards.', err);
            showToast('Could not generate flashcards: ' + (err.message || 'Please try again.'), { variant: 'error' });
            btn.disabled = false;
            btn.textContent = wasRegenerate ? 'Regenerate flashcards' : 'Generate flashcards';
        } finally {
            isGeneratingFlashcards = false;
        }
    });

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

            try {
                await learningOutputRepository.deleteLearningOutputsByResourceId(pendingDeleteId);
            } catch (outputCleanupError) {
                console.warn('StudyLens could not clean up learning outputs for deleted resource.', outputCleanupError);
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
