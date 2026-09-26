/**
 * Note Editor Controller — Day 15.
 *
 * Manages the Note creation, editing, and deletion modals:
 * - Standalone or resource-linked notes
 * - Form validation and safe character limit enforcement
 * - Integration with NoteService and ResourceStore
 */

import { resourceRepository } from '../storage/resourceStore.js';
import { createNote, deleteNote, getNote, updateNote } from './noteService.js';
import { closeDialog, openDialog } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { NOTE_CONTENT_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from '../storage/noteValidation.js';

let editingNote = null;
let pendingDeleteNoteId = null;

function noteEditorDialog() {
    return document.getElementById('note-editor-dialog');
}

function noteEditorForm() {
    return document.getElementById('note-editor-form');
}

function deleteNoteDialog() {
    return document.getElementById('delete-note-dialog');
}

function setFormError(message = '') {
    const errorEl = document.querySelector('[data-note-error]');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
}

function setSubmitting(isSubmitting) {
    const submitBtn = document.querySelector('[data-note-submit]');
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting
        ? (editingNote ? 'Saving changes…' : 'Saving…')
        : (editingNote ? 'Save changes' : 'Save note');
}

/**
 * Populates the resource selector dropdown with all available resources.
 *
 * @param {string|null} selectedResourceId
 */
async function populateResourceOptions(selectedResourceId = null) {
    const select = document.querySelector('[data-note-resource-select]');
    if (!select) return;

    select.innerHTML = '<option value="">None (Standalone note)</option>';

    try {
        const resources = await resourceRepository.getAllResources();
        resources.forEach((res) => {
            const opt = document.createElement('option');
            opt.value = res.id;
            opt.textContent = res.title;
            if (selectedResourceId && res.id === selectedResourceId) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    } catch (err) {
        console.warn('Could not populate resource dropdown in note editor:', err);
    }
}

/**
 * Opens the note editor dialog for creating or editing a note.
 *
 * @param {object|null} initialData
 * @param {string} [initialData.id] - note ID if editing existing note
 * @param {string} [initialData.resourceId] - associated resource ID
 * @param {string} [initialData.title] - initial note title
 * @param {string} [initialData.content] - initial note content
 * @param {Array<string>|string} [initialData.tags] - initial note tags
 */
export async function openNoteEditor(initialData = null) {
    const form = noteEditorForm();
    if (!form) return;

    const isEdit = Boolean(initialData?.id);
    editingNote = isEdit ? initialData : null;

    // Reset error & submission states
    setFormError();
    setSubmitting(false);

    // Update dialog headers
    const titleEl = document.querySelector('[data-note-editor-title]');
    const descEl = document.querySelector('[data-note-editor-description]');
    if (titleEl) {
        titleEl.textContent = isEdit ? 'Edit note' : 'New note';
    }
    if (descEl) {
        descEl.textContent = isEdit
            ? 'Update your note content, title, or linked resource.'
            : 'Capture key takeaways, thoughts, and study notes.';
    }

    // Populate resource dropdown first
    const resourceId = initialData?.resourceId ?? null;
    await populateResourceOptions(resourceId);

    // Fill form fields
    const idField = form.querySelector('[data-note-id]');
    if (idField) idField.value = initialData?.id ?? '';

    form.elements.title.value = initialData?.title ?? '';
    form.elements.content.value = initialData?.content ?? '';

    if (Array.isArray(initialData?.tags)) {
        form.elements.tags.value = initialData.tags.join(', ');
    } else if (typeof initialData?.tags === 'string') {
        form.elements.tags.value = initialData.tags;
    } else {
        form.elements.tags.value = '';
    }

    if (resourceId) {
        form.elements.resourceId.value = resourceId;
    }

    openDialog(noteEditorDialog());

    // Focus title if new, or content if prefilled title
    if (initialData?.title) {
        document.getElementById('note-content-input')?.focus();
    } else {
        document.getElementById('note-title-input')?.focus();
    }
}

/**
 * Opens confirmation dialog to delete a note.
 *
 * @param {string} noteId
 */
export function openDeleteNoteDialog(noteId) {
    if (!noteId) return;
    pendingDeleteNoteId = noteId;
    openDialog(deleteNoteDialog());
    document.querySelector('[data-delete-note-confirm]')?.focus();
}

/**
 * Initializes Note Editor event bindings and form handlers.
 */
export function initNoteEditor() {
    const form = noteEditorForm();
    if (form) {
        form.elements.title.maxLength = NOTE_TITLE_MAX_LENGTH;
        form.elements.content.maxLength = NOTE_CONTENT_MAX_LENGTH;

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            setFormError();

            const title = form.elements.title.value.trim();
            const content = form.elements.content.value.trim();
            const rawTags = form.elements.tags.value.trim();
            const selectedResourceId = form.elements.resourceId.value.trim() || null;
            const noteId = form.querySelector('[data-note-id]')?.value.trim() || null;

            if (!title) {
                setFormError('Please enter a title for the note.');
                form.elements.title.focus();
                return;
            }

            if (!content) {
                setFormError('Please enter note content.');
                form.elements.content.focus();
                return;
            }

            setSubmitting(true);

            try {
                if (noteId) {
                    await updateNote(noteId, {
                        title,
                        content,
                        tags: rawTags,
                        resourceId: selectedResourceId,
                    });
                    closeDialog(noteEditorDialog());
                    showToast('Note updated.');
                } else {
                    await createNote({
                        title,
                        content,
                        tags: rawTags,
                        resourceId: selectedResourceId,
                    });
                    closeDialog(noteEditorDialog());
                    showToast('Note created.');
                }
                editingNote = null;
            } catch (err) {
                console.error('StudyLens could not save note:', err);
                setFormError(err.message || 'Could not save note. Please check inputs.');
                setSubmitting(false);
            }
        });
    }

    // Global "New note" buttons
    document.querySelectorAll('[data-note-create-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
            void openNoteEditor();
        });
    });

    // Delete note confirmation button
    document.querySelector('[data-delete-note-confirm]')?.addEventListener('click', async () => {
        if (!pendingDeleteNoteId) return;

        const confirmBtn = document.querySelector('[data-delete-note-confirm]');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting…';

        try {
            const deleted = await deleteNote(pendingDeleteNoteId);
            closeDialog(deleteNoteDialog());
            if (deleted) {
                showToast('Note deleted.');
            } else {
                showToast('Note was not found or already deleted.', { variant: 'error' });
            }
            pendingDeleteNoteId = null;
        } catch (err) {
            console.error('StudyLens could not delete note:', err);
            showToast('Could not delete note: ' + (err.message || 'Please try again.'), { variant: 'error' });
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete note';
        }
    });
}
