import { showModal } from '../ui/modal.js';

const resourceMessages = {
    video: { title: 'Video import is planned', description: 'Adding video links is a future source-adapter feature. No video is being processed yet.' },
    pdf: { title: 'PDF upload is planned', description: 'PDF import and content extraction will be added in a later development phase. No file is being uploaded yet.' },
    image: { title: 'Image import is planned', description: 'Image upload and OCR will be added in a later development phase. No image is being uploaded yet.' },
    text: { title: 'Text import is planned', description: 'Text entry and content normalisation will be added in a later development phase. No text is being saved yet.' },
};

const featureMessages = {
    notes: { title: 'Notes are planned', description: 'The note workspace will be introduced after StudyLens can process and store learning material.' },
    flashcards: { title: 'Flashcards are planned', description: 'Flashcard creation and review will be introduced in a future learning-tools phase.' },
    quizzes: { title: 'Quizzes are planned', description: 'Quiz creation will be introduced in a future learning-tools phase.' },
};

export function initResourceActions() {
    document.querySelectorAll('[data-resource-action]').forEach((button) => {
        button.addEventListener('click', () => showModal(resourceMessages[button.dataset.resourceAction]));
    });
    document.querySelectorAll('[data-feature-action]').forEach((button) => {
        button.addEventListener('click', () => showModal(featureMessages[button.dataset.featureAction]));
    });
}
