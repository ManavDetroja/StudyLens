const modal = () => document.getElementById('coming-soon-modal');

export function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

export function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
}

export function showModal({ title, description }) {
    const dialog = modal();
    if (!dialog) return;
    dialog.querySelector('#modal-title').textContent = title;
    dialog.querySelector('#modal-description').textContent = description;
    openDialog(dialog);
}

export function initModal() {
    document.querySelectorAll('[data-dialog]').forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) closeDialog(dialog);
        });
    });

    document.addEventListener('click', (event) => {
        const closeButton = event.target.closest('[data-dialog-close], [data-modal-close]');
        if (closeButton) closeDialog(closeButton.closest('dialog'));
    });
}
