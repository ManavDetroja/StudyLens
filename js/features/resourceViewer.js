import { notifyResourcesChanged, onResourcesChanged } from '../core/resourceEvents.js';
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
import {
    generateQuizForResource,
    getQuizForResource,
    deleteQuizzesForResource,
} from './quizService.js';
import { deleteAttemptsForResource } from './quizAttemptService.js';
import { openQuizPlayer } from './quizPlayer.js';
import { renderLearningOutputs } from './learningOutputView.js';
import { deleteNotesForResource } from './noteService.js';
import { openNoteEditor } from './noteEditor.js';
import { getFileBlob, deleteFileBlob } from './fileImportService.js';
import { formatFileSize } from './fileImportConfig.js';
import { onProcessingChanged } from '../core/resourceEvents.js';
import { buildYouTubeThumbnailUrl } from './youtubeUrlValidator.js';
import { openPasteTranscriptDialog } from './videoResourceForm.js';
import { getProcessingDisplay } from '../processing/processingDisplay.js';
import {
    requestProcessing,
    retryProcessing,
    cancelProcessing,
    isProcessingBusy,
    getLiveProcessingJob,
} from './processingService.js';

let activeResource = null;
let pendingDeleteId = null;
let isGenerating = false;
let isGeneratingFlashcards = false;
let isGeneratingQuiz = false;
let activeBlobUrl = null;

function revokeActiveBlobUrl() {
    if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
    }
}

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

export function renderResourceContent(contentElement, content, resourceType = 'text', processed = null) {
    if (!contentElement) return;

    if (resourceType === 'pdf' && processed?.metadata?.pages && Array.isArray(processed.metadata.pages) && processed.metadata.pages.length > 0) {
        const pageSections = processed.metadata.pages.map((p) => `--- Page ${p.pageNumber} ---\n\n${p.text}`);
        contentElement.textContent = pageSections.join('\n\n');
        return;
    }

    if (content) {
        contentElement.textContent = content;
    } else if (resourceType === 'pdf') {
        contentElement.textContent = 'This PDF has been saved locally. Click "Extract PDF content" below to extract readable text and study aids.';
    } else if (resourceType === 'image') {
        contentElement.textContent = 'This image has been saved locally. Click "Extract image text" below to process readable text and study aids.';
    } else if (resourceType === 'video') {
        contentElement.textContent = 'This YouTube video has no transcript yet. Browser security restrictions prevent automatic caption scraping. Click "Paste transcript" below to add the video transcript and generate study aids.';
    } else {
        contentElement.textContent = 'No text content is available for this resource.';
    }
}

function renderFileSection(resource, fileBlobRecord) {
    const fileSection = document.querySelector('[data-resource-viewer-file-section]');
    const fileInfoContainer = document.querySelector('[data-resource-viewer-file-info]');
    const imagePreviewContainer = document.querySelector('[data-resource-viewer-image-preview]');

    revokeActiveBlobUrl();

    if (!fileSection) return;

    const isFileResource = resource.type === 'pdf' || resource.type === 'image';
    if (!isFileResource) {
        fileSection.hidden = true;
        if (fileInfoContainer) fileInfoContainer.replaceChildren();
        if (imagePreviewContainer) {
            imagePreviewContainer.replaceChildren();
            imagePreviewContainer.hidden = true;
        }
        return;
    }

    fileSection.hidden = false;

    if (fileInfoContainer) {
        fileInfoContainer.replaceChildren();

        const originalName = resource.metadata?.originalFileName || resource.title;
        const mimeType = resource.metadata?.mimeType || fileBlobRecord?.mimeType || 'Unknown';
        const size = resource.metadata?.fileSize || fileBlobRecord?.size || 0;
        const sizeStr = size > 0 ? formatFileSize(size) : 'Unknown size';
        const extension = resource.metadata?.extension || '';

        let statusText = 'File saved locally (extraction pending)';
        if (resource.status === 'completed') {
            statusText = resource.type === 'pdf' ? 'Content extracted & ready' : (resource.type === 'image' ? 'Text extracted & ready' : 'Completed');
        } else if (resource.status === 'processing') {
            statusText = 'Extracting content…';
        } else if (resource.status === 'failed') {
            statusText = 'Extraction failed';
        }

        const items = [
            { label: 'File name', value: originalName },
            { label: 'Format', value: resource.type.toUpperCase() + (extension ? ` (${extension})` : '') },
            { label: 'Size', value: sizeStr },
            { label: 'MIME type', value: mimeType },
            { label: 'Status', value: statusText },
        ];

        items.forEach(({ label, value }) => {
            const dt = document.createElement('span');
            dt.className = 'file-info-label';
            dt.textContent = label + ':';
            const dd = document.createElement('span');
            dd.className = 'file-info-value';
            dd.textContent = value;
            fileInfoContainer.append(dt, dd);
        });
    }

    if (imagePreviewContainer) {
        imagePreviewContainer.replaceChildren();
        if (resource.type === 'image' && fileBlobRecord?.blob) {
            try {
                activeBlobUrl = URL.createObjectURL(fileBlobRecord.blob);
                const img = document.createElement('img');
                img.src = activeBlobUrl;
                img.alt = resource.title || 'Imported image';
                img.loading = 'lazy';
                imagePreviewContainer.append(img);
                imagePreviewContainer.hidden = false;
            } catch (blobErr) {
                console.warn('Could not create object URL for image preview.', blobErr);
                imagePreviewContainer.hidden = true;
            }
        } else {
            imagePreviewContainer.hidden = true;
        }
    }
}

function renderVideoSection(resource, processed = null) {
    const videoSection = document.querySelector('[data-resource-viewer-video-section]');
    const videoInfoContainer = document.querySelector('[data-resource-viewer-video-info]');
    const previewContainer = document.querySelector('[data-resource-viewer-video-preview]');

    if (!videoSection) return;

    if (resource.type !== 'video') {
        videoSection.hidden = true;
        if (videoInfoContainer) videoInfoContainer.replaceChildren();
        if (previewContainer) {
            previewContainer.replaceChildren();
            previewContainer.hidden = true;
        }
        return;
    }

    videoSection.hidden = false;

    if (videoInfoContainer) {
        videoInfoContainer.replaceChildren();

        const videoId = resource.metadata?.videoId || 'Unknown';
        const canonicalUrl = resource.metadata?.canonicalUrl || resource.source || '';
        const hasTranscript = Boolean(
            (typeof resource.content === 'string' && resource.content.trim().length > 0) ||
            (processed && typeof processed.normalizedText === 'string' && processed.normalizedText.trim().length > 0)
        );

        let statusText = 'Transcript pending';
        if (hasTranscript) {
            statusText = 'Transcript available & processed';
        } else if (resource.metadata?.transcriptStatus === 'unavailable') {
            statusText = 'Transcript unavailable (CORS restricted)';
        }

        const items = [
            { label: 'Provider', value: 'YouTube' },
            { label: 'Video ID', value: videoId },
            { label: 'Transcript', value: statusText },
        ];

        if (processed?.chunks?.length) {
            items.push({ label: 'Segments', value: `${processed.chunks.length} chunks` });
        }

        items.forEach(({ label, value }) => {
            const dt = document.createElement('span');
            dt.className = 'file-info-label';
            dt.textContent = label + ':';
            const dd = document.createElement('span');
            dd.className = 'file-info-value';
            dd.textContent = value;
            videoInfoContainer.append(dt, dd);
        });

        if (canonicalUrl) {
            const dt = document.createElement('span');
            dt.className = 'file-info-label';
            dt.textContent = 'Source link:';
            const dd = document.createElement('span');
            dd.className = 'file-info-value';
            const link = document.createElement('a');
            link.className = 'video-link-action';
            link.href = canonicalUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Open on YouTube ↗';
            dd.append(link);
            videoInfoContainer.append(dt, dd);
        }
    }

    if (previewContainer) {
        previewContainer.replaceChildren();
        const videoId = resource.metadata?.videoId;
        if (videoId) {
            const thumbUrl = buildYouTubeThumbnailUrl(videoId, 'hqdefault');
            const thumbLink = document.createElement('a');
            thumbLink.href = resource.metadata?.canonicalUrl || `https://www.youtube.com/watch?v=${videoId}`;
            thumbLink.target = '_blank';
            thumbLink.rel = 'noopener noreferrer';
            thumbLink.className = 'video-thumbnail-container';

            const img = document.createElement('img');
            img.src = thumbUrl;
            img.alt = `YouTube video thumbnail for ${resource.title}`;
            img.loading = 'lazy';
            thumbLink.append(img);
            previewContainer.append(thumbLink);

            const hasTranscript = Boolean(
                (typeof resource.content === 'string' && resource.content.trim().length > 0) ||
                (processed && typeof processed.normalizedText === 'string' && processed.normalizedText.trim().length > 0)
            );

            if (!hasTranscript) {
                const notice = document.createElement('div');
                notice.className = 'video-cors-notice';
                notice.innerHTML = '<p><strong>Direct browser transcript extraction is unavailable:</strong> Modern browsers enforce CORS security policies preventing direct YouTube caption retrieval.</p><p>Click <em>"Paste transcript"</em> below to add the video transcript or captions to enable study aids.</p>';
                previewContainer.append(notice);
            }

            previewContainer.hidden = false;
        } else {
            previewContainer.hidden = true;
        }
    }
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

function renderProcessingPanel(display) {
    const panel = document.querySelector('[data-resource-viewer-processing]');
    const text = document.querySelector('[data-resource-viewer-processing-text]');
    const retryBtn = document.querySelector('[data-resource-viewer-retry-processing]');
    const cancelBtn = document.querySelector('[data-resource-viewer-cancel-processing]');
    if (!panel || !text) return;

    const visible = display.state === 'queued' || display.state === 'processing'
        || display.state === 'failed' || display.state === 'stalled';
    panel.hidden = !visible;
    panel.dataset.state = display.state;
    text.textContent = visible ? [display.label, display.detail].filter(Boolean).join(' — ') : '';

    if (retryBtn) {
        retryBtn.hidden = !display.canRetry;
        retryBtn.disabled = false;
    }
    if (cancelBtn) {
        cancelBtn.hidden = !display.canCancel;
    }
}

function renderResource(resource, processed = null, outputsSummary = null, quiz = null, fileBlobRecord = null) {
    const display = getProcessingDisplay(resource, {
        job: getLiveProcessingJob(resource.id),
        hasProcessedContent: Boolean(processed?.normalizedText),
    });

    document.querySelector('[data-resource-viewer-title]').textContent = resource.title;
    document.querySelector('[data-resource-viewer-type]').textContent = resource.type;
    document.querySelector('[data-resource-viewer-date]').textContent = 'Created ' + formatResourceDate(resource.createdAt);
    const statusEl = document.querySelector('[data-resource-viewer-status]');
    if (statusEl) {
        statusEl.textContent = display.label;
        statusEl.dataset.status = display.state;
    }
    renderProcessingPanel(display);
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
    const extractPdfBtn = document.querySelector('[data-resource-viewer-extract-pdf]');
    /* While queued/processing the primary action is disabled; after a failure
       the panel's Retry action (which enforces the retry policy) replaces it. */
    const primaryActionBlocked = display.busy || display.state === 'failed' || display.state === 'stalled';
    const primaryActionTitle = display.busy
        ? 'Processing is in progress'
        : (primaryActionBlocked ? 'Use Retry to process this resource again' : '');
    if (extractPdfBtn) {
        if (resource.type === 'pdf' || resource.type === 'image') {
            extractPdfBtn.hidden = false;
            const hasExtracted = resource.status === 'completed' || Boolean(processed?.normalizedText);
            if (display.state === 'queued') {
                extractPdfBtn.textContent = 'Queued…';
            } else if (display.busy) {
                extractPdfBtn.textContent = resource.type === 'pdf' ? 'Extracting…' : 'Processing…';
            } else if (resource.type === 'pdf') {
                extractPdfBtn.textContent = hasExtracted ? 'Reprocess PDF' : 'Extract PDF content';
            } else {
                extractPdfBtn.textContent = hasExtracted ? 'Reprocess image' : 'Extract image text';
            }
            extractPdfBtn.disabled = primaryActionBlocked;
            if (primaryActionTitle) {
                extractPdfBtn.title = primaryActionTitle;
            } else {
                extractPdfBtn.removeAttribute('title');
            }
        } else {
            extractPdfBtn.hidden = true;
        }
    }

    const processVideoBtn = document.querySelector('[data-resource-viewer-process-video]');
    const pasteTranscriptBtn = document.querySelector('[data-resource-viewer-paste-transcript]');
    const hasContent = Boolean(
        (typeof resource.content === 'string' && resource.content.trim().length > 0) ||
        (processed && typeof processed.normalizedText === 'string' && processed.normalizedText.trim().length > 0)
    );

    if (processVideoBtn) {
        if (resource.type === 'video') {
            processVideoBtn.hidden = false;
            const hasExtracted = resource.status === 'completed' || Boolean(processed?.normalizedText);
            if (display.state === 'queued') {
                processVideoBtn.textContent = 'Queued…';
            } else if (display.busy) {
                processVideoBtn.textContent = 'Processing transcript…';
            } else {
                processVideoBtn.textContent = hasExtracted ? 'Reprocess transcript' : 'Process transcript';
            }
            processVideoBtn.disabled = primaryActionBlocked || !hasContent;
            if (primaryActionTitle) {
                processVideoBtn.title = primaryActionTitle;
            } else {
                processVideoBtn.removeAttribute('title');
            }
        } else {
            processVideoBtn.hidden = true;
        }
    }

    if (pasteTranscriptBtn) {
        if (resource.type === 'video') {
            pasteTranscriptBtn.hidden = false;
            pasteTranscriptBtn.textContent = hasContent ? 'Edit transcript' : 'Paste transcript';
        } else {
            pasteTranscriptBtn.hidden = true;
        }
    }
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
            if (quiz && quiz.questions?.length > 0) {
                parts.push(`Quiz (${quiz.questions.length} question${quiz.questions.length === 1 ? '' : 's'})`);
            }
            outputsSummaryElement.textContent = parts.join(' • ');
            outputsSummaryElement.hidden = false;
        } else {
            outputsSummaryElement.textContent = '';
            outputsSummaryElement.hidden = true;
        }
    }

    /* Day 22 downstream protection: never generate from content that is still
       being (re)processed, or whose only processing attempt failed. A failed
       REprocess keeps its previous valid processed content, so generation
       from that previous result stays available. */
    const hasUsableProcessed = Boolean(processed?.normalizedText);
    const generationBlocked = display.busy
        || ((display.state === 'failed' || display.state === 'stalled') && !hasUsableProcessed);
    const generationBlockedTitle = display.busy
        ? 'Wait for processing to finish'
        : 'Processing failed. Retry processing first';

    const generateBtn = document.querySelector('[data-resource-viewer-generate]');
    if (generateBtn) {
        if (!hasContent) {
            generateBtn.disabled = true;
            generateBtn.title = 'Add text content to generate learning outputs';
            generateBtn.textContent = 'Generate learning outputs';
        } else if (generationBlocked) {
            generateBtn.disabled = true;
            generateBtn.title = generationBlockedTitle;
            generateBtn.textContent = hasOutputs ? 'Regenerate learning outputs' : 'Generate learning outputs';
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
        } else if (generationBlocked) {
            generateFlashcardsBtn.disabled = true;
            generateFlashcardsBtn.title = generationBlockedTitle;
            generateFlashcardsBtn.textContent = hasFlashcards ? 'Regenerate flashcards' : 'Generate flashcards';
        } else {
            generateFlashcardsBtn.disabled = false;
            generateFlashcardsBtn.removeAttribute('title');
            generateFlashcardsBtn.textContent = hasFlashcards ? 'Regenerate flashcards' : 'Generate flashcards';
        }
    }

    const generateQuizBtn = document.querySelector('[data-resource-viewer-generate-quiz]');
    const hasQuiz = Boolean(quiz && quiz.questions?.length > 0);

    if (generateQuizBtn) {
        if (!hasContent) {
            generateQuizBtn.disabled = true;
            generateQuizBtn.title = 'Add text content to generate quiz';
            generateQuizBtn.textContent = 'Generate quiz';
        } else if (generationBlocked) {
            generateQuizBtn.disabled = true;
            generateQuizBtn.title = generationBlockedTitle;
            generateQuizBtn.textContent = hasQuiz ? 'Regenerate quiz' : 'Generate quiz';
        } else {
            generateQuizBtn.disabled = false;
            generateQuizBtn.removeAttribute('title');
            generateQuizBtn.textContent = hasQuiz ? 'Regenerate quiz' : 'Generate quiz';
        }
    }

    if (outputsContainer) {
        if (!hasContent) {
            renderLearningOutputs(outputsContainer, {
                status: 'empty',
                emptyMessage: 'This resource has no text content. Add content to generate learning outputs.',
            });
        } else if (hasOutputs || hasQuiz) {
            renderLearningOutputs(outputsContainer, {
                status: 'ready',
                outputs: outputsSummary?.outputs ?? [],
                quiz,
                onStudyFlashcards: () => {
                    const cards = outputsSummary?.outputs?.filter((o) => o.type === 'flashcard') ?? [];
                    if (cards.length > 0) {
                        openFlashcardViewer(cards, resource.title);
                    }
                },
                onStartQuiz: () => {
                    if (quiz) {
                        openQuizPlayer(quiz);
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

    renderFileSection(resource, fileBlobRecord);
    renderVideoSection(resource, processed);
    renderResourceContent(document.querySelector('[data-resource-viewer-content]'), resource.content, resource.type, processed);
    renderTags(resource.tags);
}

export async function refreshResourceViewer(resourceId) {
    const resource = await resourceRepository.getResource(resourceId);
    if (!resource) return null;
    activeResource = resource;

    let processed = null;
    try {
        processed = await getProcessedContent(resourceId);
    } catch {
        // Enhancement
    }

    let outputsSummary = null;
    try {
        outputsSummary = await getLearningOutputsSummaryForResource(resourceId);
    } catch {
        // Enhancement
    }

    let quiz = null;
    try {
        quiz = await getQuizForResource(resourceId);
    } catch {
        // Enhancement
    }

    let fileBlobRecord = null;
    if (resource.type === 'pdf' || resource.type === 'image') {
        try {
            fileBlobRecord = await getFileBlob(resourceId);
        } catch {
            // Enhancement
        }
    }

    renderResource(resource, processed, outputsSummary, quiz, fileBlobRecord);
    return { resource, processed, outputsSummary, quiz, fileBlobRecord };
}

export async function openResourceViewer(resourceId) {
    try {
        const resource = await resourceRepository.getResource(resourceId);
        if (!resource) {
            showToast('This resource is no longer available.', { variant: 'error' });
            return;
        }

        await refreshResourceViewer(resourceId);
        openDialog(viewerDialog());
    } catch (error) {
        console.error('StudyLens could not open the resource.', error);
        showToast('StudyLens could not open this resource. Please try again.', { variant: 'error' });
    }
}

function describeFailureToast(job, resourceType) {
    const code = job?.errorCode;
    if (code === 'NO_SELECTABLE_TEXT') {
        return 'No selectable text was found in this PDF. OCR will be supported in a future milestone.';
    }
    if (code === 'NO_EXTRACTED_TEXT') {
        return 'No readable text could be extracted from this image. Please ensure the image contains legible text.';
    }
    const noun = resourceType === 'pdf' ? 'PDF' : (resourceType === 'image' ? 'image' : (resourceType === 'video' ? 'video transcript' : 'resource'));
    return `Could not process ${noun}: ` + (job?.errorMessage || 'Please try again.');
}

async function refreshViewerIfActive(resourceId) {
    if (!activeResource || activeResource.id !== resourceId) return;
    const dialog = viewerDialog();
    if (!dialog || !dialog.open) return;
    try {
        await refreshResourceViewer(resourceId);
    } catch (error) {
        console.warn('StudyLens could not refresh the resource viewer.', error);
    }
}

/**
 * Request processing through the queue and report the outcome once.
 * Repeated clicks are de-duplicated by the queue; only the click that
 * actually created the job reports completion.
 */
async function requestQueuedProcessing(resource, { successMessage, reason = 'requested' }) {
    const resourceId = resource.id;
    const resourceType = resource.type;

    let request;
    try {
        request = await requestProcessing(resourceId, { reason });
    } catch (error) {
        console.error('StudyLens could not queue processing.', error);
        showToast('StudyLens could not start processing. Please try again.', { variant: 'error' });
        return;
    }

    if (request.deduplicated) {
        showToast('This resource is already queued or being processed.');
        return;
    }

    await refreshViewerIfActive(resourceId);
    const job = await request.completion;
    await refreshViewerIfActive(resourceId);

    if (job?.status === 'completed') {
        showToast(successMessage);
    } else if (job?.status === 'failed') {
        showToast(describeFailureToast(job, resourceType), { variant: 'error' });
    }
}

export function initResourceViewer() {
    document.querySelector('[data-resource-viewer-extract-pdf]')?.addEventListener('click', async (event) => {
        if (!activeResource || (activeResource.type !== 'pdf' && activeResource.type !== 'image')) return;
        if (isProcessingBusy(activeResource.id)) return;

        const wasReprocess = event.currentTarget.textContent.toLowerCase().includes('reprocess');
        const typeLabel = activeResource.type === 'pdf' ? 'PDF' : 'Image';

        await requestQueuedProcessing(activeResource, {
            successMessage: wasReprocess ? `${typeLabel} reprocessed successfully.` : `${typeLabel} content extracted successfully.`,
        });
    });

    document.querySelector('[data-resource-viewer-process-video]')?.addEventListener('click', async () => {
        if (!activeResource || activeResource.type !== 'video') return;
        if (isProcessingBusy(activeResource.id)) return;

        const hasContent = typeof activeResource.content === 'string' && activeResource.content.trim().length > 0;
        if (!hasContent) {
            showToast('No transcript content available to process. Please paste transcript first.', { variant: 'error' });
            return;
        }

        await requestQueuedProcessing(activeResource, {
            successMessage: 'Video transcript processed successfully.',
        });
    });

    document.querySelector('[data-resource-viewer-retry-processing]')?.addEventListener('click', async (event) => {
        if (!activeResource) return;
        const resource = activeResource;
        event.currentTarget.disabled = true;

        let request;
        try {
            request = await retryProcessing(resource.id);
        } catch (error) {
            console.error('StudyLens could not retry processing.', error);
            showToast('StudyLens could not retry processing. Please try again.', { variant: 'error' });
            await refreshViewerIfActive(resource.id);
            return;
        }

        if (!request.accepted) {
            if (request.reason === 'RETRY_LIMIT_REACHED') {
                showToast('Retry limit reached for this resource.', { variant: 'error' });
            } else if (request.reason === 'NON_RETRYABLE') {
                showToast('This failure cannot be fixed by retrying.', { variant: 'error' });
            }
            await refreshViewerIfActive(resource.id);
            return;
        }

        await refreshViewerIfActive(resource.id);
        const job = await request.completion;
        await refreshViewerIfActive(resource.id);
        if (job?.status === 'completed') {
            showToast('Processing completed after retry.');
        } else if (job?.status === 'failed') {
            showToast(describeFailureToast(job, resource.type), { variant: 'error' });
        }
    });

    document.querySelector('[data-resource-viewer-cancel-processing]')?.addEventListener('click', async () => {
        if (!activeResource) return;
        const result = cancelProcessing(activeResource.id);
        if (result.cancelled) {
            showToast('Processing cancelled.');
        } else if (result.reason === 'ACTIVE_CANCEL_UNSUPPORTED') {
            showToast('Processing already started and cannot be cancelled.', { variant: 'error' });
        }
        await refreshViewerIfActive(activeResource.id);
    });

    document.querySelector('[data-resource-viewer-paste-transcript]')?.addEventListener('click', () => {
        if (!activeResource || activeResource.type !== 'video') return;
        openPasteTranscriptDialog(activeResource);
    });

    document.querySelector('[data-resource-viewer-generate]')?.addEventListener('click', async (event) => {
        if (isGenerating || !activeResource) return;
        if (isProcessingBusy(activeResource.id)) {
            showToast('Wait for processing to finish before generating learning outputs.', { variant: 'error' });
            return;
        }

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
            await refreshResourceViewer(activeResource.id);
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
        if (isProcessingBusy(activeResource.id)) {
            showToast('Wait for processing to finish before generating flashcards.', { variant: 'error' });
            return;
        }

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
            await refreshResourceViewer(activeResource.id);
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

    document.querySelector('[data-resource-viewer-generate-quiz]')?.addEventListener('click', async (event) => {
        if (isGeneratingQuiz || !activeResource) return;
        if (isProcessingBusy(activeResource.id)) {
            showToast('Wait for processing to finish before generating a quiz.', { variant: 'error' });
            return;
        }

        const hasContent = typeof activeResource.content === 'string' && activeResource.content.trim().length > 0;
        if (!hasContent) {
            showToast('Cannot generate quiz for empty content.', { variant: 'error' });
            return;
        }

        const btn = event.currentTarget;
        const wasRegenerate = btn.textContent.toLowerCase().includes('regenerate');

        isGeneratingQuiz = true;
        btn.disabled = true;
        btn.textContent = 'Generating…';

        try {
            await generateQuizForResource(activeResource.id);
            await refreshResourceViewer(activeResource.id);
            showToast(wasRegenerate ? 'Quiz regenerated.' : 'Quiz generated.');
        } catch (err) {
            console.error('StudyLens could not generate quiz.', err);
            showToast('Could not generate quiz: ' + (err.message || 'Please try again.'), { variant: 'error' });
            btn.disabled = false;
            btn.textContent = wasRegenerate ? 'Regenerate quiz' : 'Generate quiz';
        } finally {
            isGeneratingQuiz = false;
        }
    });

    document.querySelector('[data-resource-viewer-add-note]')?.addEventListener('click', () => {
        if (!activeResource) return;
        const res = activeResource;
        closeDialog(viewerDialog());
        void openNoteEditor({
            resourceId: res.id,
            title: 'Notes — ' + res.title,
            tags: Array.isArray(res.tags) ? [...res.tags] : [],
        });
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
            cancelProcessing(pendingDeleteId);
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

            try {
                await deleteQuizzesForResource(pendingDeleteId);
            } catch (quizCleanupError) {
                console.warn('StudyLens could not clean up quizzes for deleted resource.', quizCleanupError);
            }

            try {
                await deleteAttemptsForResource(pendingDeleteId);
            } catch (attemptCleanupError) {
                console.warn('StudyLens could not clean up quiz attempts for deleted resource.', attemptCleanupError);
            }

            try {
                await deleteNotesForResource(pendingDeleteId);
            } catch (noteCleanupError) {
                console.warn('StudyLens could not clean up notes for deleted resource.', noteCleanupError);
            }

            try {
                await deleteFileBlob(pendingDeleteId);
            } catch (fileBlobCleanupError) {
                console.warn('StudyLens could not clean up file blob for deleted resource.', fileBlobCleanupError);
            }

            revokeActiveBlobUrl();
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

    viewerDialog()?.addEventListener('close', () => {
        revokeActiveBlobUrl();
    });

    onResourcesChanged(async ({ action, resourceId }) => {
        if (activeResource && activeResource.id === resourceId && action === 'updated') {
            const dialog = viewerDialog();
            if (dialog && dialog.open) {
                await refreshResourceViewer(resourceId);
            }
        }
    });

    onProcessingChanged(async ({ resourceId }) => {
        if (!activeResource || activeResource.id !== resourceId) return;
        const dialog = viewerDialog();
        if (dialog && dialog.open) {
            try {
                await refreshResourceViewer(resourceId);
            } catch (error) {
                console.warn('StudyLens could not refresh the resource viewer.', error);
            }
        }
    });
}
