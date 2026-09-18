const modal = () => document.getElementById('coming-soon-modal');

export function showModal({ title, description }) {
    const dialog = modal();
    if (!dialog) return;
    dialog.querySelector('#modal-title').textContent = title;
    dialog.querySelector('#modal-description').textContent = description;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

export function initModal() {
    const dialog = modal();
    if (!dialog) return;
    dialog.querySelectorAll('[data-modal-close]').forEach((button) => {
        button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
}
