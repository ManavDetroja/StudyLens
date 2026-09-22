import { notifyResourcesChanged } from '../core/resourceEvents.js';
import { resourceRepository } from '../storage/resourceStore.js';
import { closeDialog, openDialog, showModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { processAndStore } from './processingIntegration.js';
import {
    TEXT_RESOURCE_CONTENT_MAX_LENGTH,
    TEXT_RESOURCE_TITLE_MAX_LENGTH,
    createTextResourceInput,
    createTextResourceUpdate,
} from './textResourceInput.js';

const resourceMessages = {
    video: { title: 'Video import is planned', description: 'Adding video links is a future source-adapter feature. No video is being processed yet.' },
    pdf: { title: 'PDF upload is planned', description: 'PDF import and content extraction will be added in a later development phase. No file is being uploaded yet.' },
    image: { title: 'Image import is planned', description: 'Image upload and OCR will be added in a later development phase. No image is being uploaded yet.' },
};

const featureMessages = {
    notes: { title: 'Notes are planned', description: 'The note workspace will be introduced after StudyLens can process and store learning material.' },
    flashcards: { title: 'Flashcards are planned', description: 'Flashcard creation and review will be introduced in a future learning-tools phase.' },
    quizzes: { title: 'Quizzes are planned', description: 'Quiz creation will be introduced in a future learning-tools phase.' },
};

let editingResource = null;

function textResourceDialog() {
    return document.getElementById('text-resource-dialog');
}

function textResourceForm() {
    return document.getElementById('text-resource-form');
}

function setFormError(message = '') {
    const error = document.querySelector('[data-text-resource-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
}

function setSubmitting(isSubmitting) {
    const submitButton = document.querySelector('[data-text-resource-submit]');
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.textContent = isSubmitting
        ? (editingResource ? 'Saving changes…' : 'Saving…')
        : (editingResource ? 'Save changes' : 'Save resource');
}

function populateTextResourceForm(resource) {
    const form = textResourceForm();
    if (!form) return;

    form.elements.title.value = resource?.title ?? '';
    form.elements.content.value = resource?.content ?? '';
    form.elements.tags.value = resource?.tags?.join(', ') ?? '';
    document.querySelector('[data-text-resource-title]').textContent = resource ? 'Edit text resource' : 'Add text resource';
    document.querySelector('[data-text-resource-description]').textContent = resource
        ? 'Update the title, text, or tags. Your original creation date stays unchanged.'
        : 'Save written learning material to your local StudyLens library.';
    setSubmitting(false);
    setFormError();
}

export function openTextResourceForm(resource = null) {
    editingResource = resource;
    populateTextResourceForm(resource);
    openDialog(textResourceDialog());
    document.getElementById('text-resource-title-input')?.focus();
}

export function initResourceActions() {
    document.querySelectorAll('[data-resource-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.resourceAction;
            if (action === 'text') {
                openTextResourceForm();
                return;
            }
            showModal(resourceMessages[action]);
        });
    });

    document.querySelectorAll('[data-open-text-resource]').forEach((button) => {
        button.addEventListener('click', () => openTextResourceForm());
    });

    document.querySelectorAll('[data-feature-action]').forEach((button) => {
        button.addEventListener('click', () => showModal(featureMessages[button.dataset.featureAction]));
    });

    const form = textResourceForm();
    if (!form) return;

    form.elements.title.maxLength = TEXT_RESOURCE_TITLE_MAX_LENGTH;
    form.elements.content.maxLength = TEXT_RESOURCE_CONTENT_MAX_LENGTH;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormError();
        setSubmitting(true);

        try {
            const formValues = {
                title: form.elements.title.value,
                content: form.elements.content.value,
                tags: form.elements.tags.value,
            };
            const resource = editingResource
                ? await resourceRepository.updateResource(editingResource.id, createTextResourceUpdate(formValues))
                : await resourceRepository.createResource(createTextResourceInput(formValues));

            /* Process the text resource in the background — non-fatal on failure */
            try {
                await processAndStore(resource);
            } catch (processingError) {
                console.warn('StudyLens could not process this resource.', processingError);
            }

            closeDialog(textResourceDialog());
            notifyResourcesChanged({
                action: editingResource ? 'updated' : 'created',
                resourceId: resource.id,
            });
            showToast(editingResource ? 'Text resource updated.' : 'Text resource added to your library.');
            editingResource = null;
            form.reset();
        } catch (error) {
            console.error('StudyLens could not save the text resource.', error);
            setFormError(error.code?.startsWith('TEXT_RESOURCE_')
                ? error.message
                : 'StudyLens could not save this resource. Please try again.');
        } finally {
            setSubmitting(false);
        }
    });
}
