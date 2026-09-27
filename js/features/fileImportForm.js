import { closeDialog, openDialog } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { formatFileSize, FILE_IMPORT_CONFIG } from './fileImportConfig.js';
import {
    validateFile,
    deriveTitle,
    getExtension,
} from './fileImportValidation.js';
import { importFile } from './fileImportService.js';

function fileImportDialog() {
    return document.getElementById('file-import-dialog');
}

function fileImportForm() {
    return document.getElementById('file-import-form');
}

function setFormError(message = '') {
    const error = document.querySelector('[data-file-import-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
}

function setSubmitting(isSubmitting) {
    const submitButton = document.querySelector('[data-file-import-submit]');
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.textContent = isSubmitting ? 'Importing…' : 'Import file';
}

function updatePreview(file) {
    const previewContainer = document.querySelector('[data-file-import-preview]');
    const nameEl = document.querySelector('[data-file-import-preview-name]');
    const metaEl = document.querySelector('[data-file-import-preview-meta]');
    const submitBtn = document.querySelector('[data-file-import-submit]');

    if (!file) {
        if (previewContainer) previewContainer.hidden = true;
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    if (nameEl) nameEl.textContent = file.name;
    if (metaEl) {
        const ext = getExtension(file.name).toUpperCase().replace(/^\./, '');
        const sizeStr = formatFileSize(file.size);
        metaEl.textContent = `${ext || 'FILE'} • ${sizeStr}`;
    }
    if (previewContainer) previewContainer.hidden = false;
    if (submitBtn) submitBtn.disabled = false;
}

export function openFileImportForm({ preselectedType = null } = {}) {
    const form = fileImportForm();
    if (!form) return;

    form.reset();
    setFormError('');
    setSubmitting(false);
    updatePreview(null);

    const titleEl = document.querySelector('[data-file-import-title]');
    const descEl = document.querySelector('[data-file-import-description]');
    const fileInput = document.getElementById('file-import-input');

    if (preselectedType === 'pdf') {
        if (titleEl) titleEl.textContent = 'Upload PDF';
        if (descEl) descEl.textContent = 'Import a PDF document into your StudyLens library.';
        if (fileInput) fileInput.accept = '.pdf,application/pdf';
    } else if (preselectedType === 'image') {
        if (titleEl) titleEl.textContent = 'Upload image';
        if (descEl) descEl.textContent = 'Import an image (JPG, PNG, WEBP) into your StudyLens library.';
        if (fileInput) fileInput.accept = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
    } else {
        if (titleEl) titleEl.textContent = 'Upload a file';
        if (descEl) descEl.textContent = 'Import a PDF document or image file into your StudyLens library.';
        if (fileInput) fileInput.accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
    }

    form.elements.title.maxLength = FILE_IMPORT_CONFIG.titleMaxLength;

    openDialog(fileImportDialog());
    fileInput?.focus();
}

export function initFileImportForm() {
    const form = fileImportForm();
    if (!form) return;

    const fileInput = document.getElementById('file-import-input');
    const titleInput = document.getElementById('file-import-title-input');

    let titleManuallyEdited = false;

    titleInput?.addEventListener('input', () => {
        titleManuallyEdited = true;
    });

    fileInput?.addEventListener('change', () => {
        setFormError('');
        const file = fileInput.files?.[0];

        if (!file) {
            updatePreview(null);
            return;
        }

        try {
            validateFile(file);
            updatePreview(file);

            if (!titleManuallyEdited || !titleInput.value.trim()) {
                titleInput.value = deriveTitle(file.name);
                titleManuallyEdited = false;
            }
        } catch (validationErr) {
            updatePreview(null);
            setFormError(validationErr.message);
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormError('');

        const file = fileInput?.files?.[0];
        if (!file) {
            setFormError('Please select a file to import.');
            return;
        }

        const title = form.elements.title.value;
        const tags = form.elements.tags.value;

        setSubmitting(true);

        try {
            const resource = await importFile(file, { title, tags });

            closeDialog(fileImportDialog());
            showToast(`File imported: ${resource.title}`);
            form.reset();
            updatePreview(null);
            titleManuallyEdited = false;
        } catch (error) {
            console.error('StudyLens could not import file.', error);
            setFormError(error.message || 'StudyLens could not import this file. Please try again.');
        } finally {
            setSubmitting(false);
        }
    });
}
