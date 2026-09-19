let hideTimeout;

export function showToast(message, { variant = 'success' } = {}) {
    const toast = document.querySelector('[data-toast]');
    if (!toast) return;

    toast.textContent = message;
    toast.dataset.variant = variant;
    toast.hidden = false;

    window.clearTimeout(hideTimeout);
    hideTimeout = window.setTimeout(() => {
        toast.hidden = true;
    }, 4200);
}
