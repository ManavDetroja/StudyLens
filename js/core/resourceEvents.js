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
