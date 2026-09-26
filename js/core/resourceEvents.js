const resourceEvents = new EventTarget();
const RESOURCES_CHANGED = 'resourceschanged';
const LEARNING_OUTPUTS_CHANGED = 'learningoutputschanged';

export function notifyResourcesChanged(detail) {
    resourceEvents.dispatchEvent(new CustomEvent(RESOURCES_CHANGED, { detail }));
}

export function onResourcesChanged(listener) {
    const handler = (event) => listener(event.detail);
    resourceEvents.addEventListener(RESOURCES_CHANGED, handler);

    return () => resourceEvents.removeEventListener(RESOURCES_CHANGED, handler);
}

export function notifyLearningOutputsChanged(detail) {
    resourceEvents.dispatchEvent(new CustomEvent(LEARNING_OUTPUTS_CHANGED, { detail }));
}

export function onLearningOutputsChanged(listener) {
    const handler = (event) => listener(event.detail);
    resourceEvents.addEventListener(LEARNING_OUTPUTS_CHANGED, handler);

    return () => resourceEvents.removeEventListener(LEARNING_OUTPUTS_CHANGED, handler);
}

const QUIZZES_CHANGED = 'quizzeschanged';

export function notifyQuizzesChanged(detail) {
    resourceEvents.dispatchEvent(new CustomEvent(QUIZZES_CHANGED, { detail }));
}

export function onQuizzesChanged(listener) {
    const handler = (event) => listener(event.detail);
    resourceEvents.addEventListener(QUIZZES_CHANGED, handler);

    return () => resourceEvents.removeEventListener(QUIZZES_CHANGED, handler);
}

const QUIZ_ATTEMPTS_CHANGED = 'quizattemptschanged';

export function notifyQuizAttemptsChanged(detail) {
    resourceEvents.dispatchEvent(new CustomEvent(QUIZ_ATTEMPTS_CHANGED, { detail }));
}

export function onQuizAttemptsChanged(listener) {
    const handler = (event) => listener(event.detail);
    resourceEvents.addEventListener(QUIZ_ATTEMPTS_CHANGED, handler);

    return () => resourceEvents.removeEventListener(QUIZ_ATTEMPTS_CHANGED, handler);
}

