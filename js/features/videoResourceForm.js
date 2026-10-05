/**
 * YouTube Video Resource Form & Transcript Management — Day 21.
 *
 * Provides dialogs and event handlers for:
 * 1. Adding a YouTube video resource by URL, with optional initial transcript.
 * 2. Pasting or updating a transcript for an existing video resource.
 * 3. Client-side validation and reactive notification of resource changes.
 */

import { parseYouTubeUrl } from './youtubeUrlValidator.js';
import { parseTranscriptText } from '../processing/transcriptParser.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { processAndStore } from './processingIntegration.js';
import { openDialog, closeDialog } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { notifyResourcesChanged } from '../core/resourceEvents.js';
import { normalizeTags, validateTags } from '../utils/tagUtils.js';

let activeTranscriptTargetResource = null;

function videoResourceDialog() {
    return document.getElementById('video-resource-dialog');
}

function videoResourceForm() {
    return document.getElementById('video-resource-form');
}

function pasteTranscriptDialog() {
    return document.getElementById('paste-transcript-dialog');
}

function pasteTranscriptForm() {
    return document.getElementById('paste-transcript-form');
}

function setVideoFormError(message = '') {
    const errorEl = document.querySelector('[data-video-resource-error]');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
}

function setVideoSubmitting(isSubmitting) {
    const btn = document.querySelector('[data-video-resource-submit]');
    if (!btn) return;
    btn.disabled = isSubmitting;
    btn.textContent = isSubmitting ? 'Adding video…' : 'Add video';
}

function setPasteError(message = '') {
    const errorEl = document.querySelector('[data-paste-transcript-error]');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
}

function setPasteSubmitting(isSubmitting) {
    const btn = document.querySelector('[data-paste-transcript-submit]');
    if (!btn) return;
    btn.disabled = isSubmitting;
    btn.textContent = isSubmitting ? 'Saving transcript…' : 'Save & process transcript';
}

/**
 * Open the Add Video Resource dialog.
 *
 * @param {object} [defaults]
 * @param {string} [defaults.url]
 * @param {string} [defaults.title]
 * @param {string} [defaults.tags]
 */
export function openVideoResourceForm(defaults = {}) {
    const form = videoResourceForm();
    if (!form) return;

    form.reset();
    setVideoFormError('');
    setVideoSubmitting(false);

    if (defaults.url) form.elements.url.value = defaults.url;
    if (defaults.title) form.elements.title.value = defaults.title;
    if (defaults.tags) form.elements.tags.value = defaults.tags;

    openDialog(videoResourceDialog());
    document.getElementById('video-resource-url-input')?.focus();
}

/**
 * Open the Paste Transcript dialog for an existing video resource.
 *
 * @param {object} resource
 */
export function openPasteTranscriptDialog(resource) {
    if (!resource || resource.type !== 'video') return;

    activeTranscriptTargetResource = resource;
    const form = pasteTranscriptForm();
    if (!form) return;

    form.reset();
    setPasteError('');
    setPasteSubmitting(false);

    const titleEl = document.querySelector('[data-paste-transcript-resource-title]');
    if (titleEl) {
        titleEl.textContent = resource.title;
    }

    const textarea = document.getElementById('paste-transcript-textarea');
    if (textarea) {
        textarea.value = resource.metadata?.transcript || resource.content || '';
    }

    openDialog(pasteTranscriptDialog());
    textarea?.focus();
}

/**
 * Initialize event listeners for video resource creation and transcript pasting.
 */
export function initVideoResourceForm() {
    const form = videoResourceForm();
    if (form) {
        const urlInput = document.getElementById('video-resource-url-input');
        const titleInput = document.getElementById('video-resource-title-input');
        let titleEditedManually = false;

        titleInput?.addEventListener('input', () => {
            titleEditedManually = true;
        });

        urlInput?.addEventListener('blur', () => {
            const rawUrl = urlInput.value.trim();
            if (!rawUrl) return;

            const parseResult = parseYouTubeUrl(rawUrl);
            if (parseResult.isValid) {
                setVideoFormError('');
                if (!titleEditedManually || !titleInput.value.trim()) {
                    titleInput.value = `YouTube Video (${parseResult.videoId})`;
                    titleEditedManually = false;
                }
            } else {
                setVideoFormError(parseResult.reason || 'Invalid YouTube URL.');
            }
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            setVideoFormError('');

            const urlVal = form.elements.url?.value?.trim() || '';
            const titleVal = form.elements.title?.value?.trim() || '';
            const tagsVal = form.elements.tags?.value || '';
            const transcriptVal = form.elements.transcript?.value?.trim() || '';

            const parseResult = parseYouTubeUrl(urlVal);
            if (!parseResult.isValid) {
                setVideoFormError(parseResult.reason || 'Please enter a valid YouTube video URL.');
                urlInput?.focus();
                return;
            }

            if (!titleVal) {
                setVideoFormError('Please enter a title for this video resource.');
                titleInput?.focus();
                return;
            }

            let normalizedTags;
            try {
                normalizedTags = normalizeTags(tagsVal);
                validateTags(normalizedTags);
            } catch (tagErr) {
                setVideoFormError(tagErr.message || 'Invalid tags format.');
                return;
            }

            setVideoSubmitting(true);

            try {
                let parsedTranscript = null;
                if (transcriptVal) {
                    parsedTranscript = parseTranscriptText(transcriptVal);
                }

                const resourceInput = {
                    title: titleVal.slice(0, 160),
                    type: 'video',
                    source: parseResult.canonicalUrl,
                    content: parsedTranscript ? parsedTranscript.text : null,
                    status: parsedTranscript ? 'completed' : 'pending',
                    tags: normalizedTags,
                    metadata: {
                        provider: 'youtube',
                        videoId: parseResult.videoId,
                        canonicalUrl: parseResult.canonicalUrl,
                        originalUrl: parseResult.originalUrl,
                        transcriptStatus: parsedTranscript ? 'available' : 'unavailable',
                        hasTimestamps: parsedTranscript ? parsedTranscript.hasTimestamps : false,
                        transcript: parsedTranscript ? parsedTranscript.rawText : null,
                    },
                };

                const resource = await resourceRepository.createResource(resourceInput);

                // If transcript was provided during creation, automatically process it
                if (parsedTranscript) {
                    try {
                        await processAndStore(resource);
                    } catch (processingErr) {
                        console.warn('StudyLens could not process video transcript immediately.', processingErr);
                    }
                }

                closeDialog(videoResourceDialog());
                notifyResourcesChanged({
                    action: 'created',
                    resourceId: resource.id,
                });
                showToast(`Video resource added: ${resource.title}`);
                form.reset();
                titleEditedManually = false;
            } catch (error) {
                console.error('StudyLens could not save the video resource.', error);
                setVideoFormError(error.message || 'Could not save video resource.');
            } finally {
                setVideoSubmitting(false);
            }
        });
    }

    const pasteForm = pasteTranscriptForm();
    if (pasteForm) {
        pasteForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            setPasteError('');

            if (!activeTranscriptTargetResource) {
                setPasteError('No active video resource selected.');
                return;
            }

            const rawText = pasteForm.elements.transcript?.value?.trim() || '';
            if (!rawText) {
                setPasteError('Please paste transcript text or captions.');
                return;
            }

            setPasteSubmitting(true);

            try {
                const parsed = parseTranscriptText(rawText);
                const currentRes = await resourceRepository.getResource(activeTranscriptTargetResource.id);
                if (!currentRes) {
                    throw new Error('Video resource no longer exists.');
                }

                const updated = await resourceRepository.updateResource(currentRes.id, {
                    content: parsed.text,
                    status: 'completed',
                    metadata: {
                        ...(currentRes.metadata || {}),
                        transcript: parsed.rawText,
                        transcriptStatus: 'available',
                        hasTimestamps: parsed.hasTimestamps,
                        segmentCount: parsed.segments.length,
                    },
                });

                // Immediately process through orchestrator
                try {
                    await processAndStore(updated);
                } catch (procErr) {
                    console.warn('StudyLens encountered an error processing pasted transcript.', procErr);
                }

                closeDialog(pasteTranscriptDialog());
                notifyResourcesChanged({
                    action: 'updated',
                    resourceId: updated.id,
                });
                showToast('Transcript added and processed.');
                pasteForm.reset();
                activeTranscriptTargetResource = null;
            } catch (err) {
                console.error('StudyLens could not save pasted transcript.', err);
                setPasteError(err.message || 'Could not save transcript.');
            } finally {
                setPasteSubmitting(false);
            }
        });
    }
}
