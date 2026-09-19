const resourceEvents = new EventTarget();
const RESOURCES_CHANGED = 'resourceschanged';

export function notifyResourcesChanged(detail) {
    resourceEvents.dispatchEvent(new CustomEvent(RESOURCES_CHANGED, { detail }));
}

export function onResourcesChanged(listener) {
    const handler = (event) => listener(event.detail);
    resourceEvents.addEventListener(RESOURCES_CHANGED, handler);

    return () => resourceEvents.removeEventListener(RESOURCES_CHANGED, handler);
}
