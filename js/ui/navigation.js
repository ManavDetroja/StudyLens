import { getRouteFromHash } from '../core/routes.js';

function setMobileNavigation(shell, isOpen) {
    const toggle = document.querySelector('[data-mobile-nav-toggle]');
    shell.classList.toggle('is-mobile-nav-open', isOpen);
    toggle?.setAttribute('aria-expanded', String(isOpen));
    toggle?.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
}

function renderRoute(route, shouldFocus = false) {
    document.querySelectorAll('[data-page]').forEach((page) => {
        const isActive = page.dataset.page === route.id;
        page.hidden = !isActive;
        page.classList.toggle('is-active', isActive);
    });

    document.querySelectorAll('[data-route]').forEach((item) => {
        const isActive = item.dataset.route === route.id;
        item.classList.toggle('is-active', isActive);
        if (isActive) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
    });

    document.querySelector('[data-page-title]').textContent = route.title;
    document.querySelector('[data-page-description]').textContent = route.description;
    document.title = route.title + ' — StudyLens';
    if (shouldFocus) document.getElementById('main-content')?.focus();
}

export function initNavigation() {
    const shell = document.querySelector('[data-app-shell]');
    if (!shell) return;

    const updateFromLocation = (shouldFocus = false) => {
        renderRoute(getRouteFromHash(window.location.hash), shouldFocus);
    };

    document.querySelectorAll('[data-route]').forEach((item) => {
        item.addEventListener('click', () => {
            const routeId = item.dataset.route;
            setMobileNavigation(shell, false);
            if (window.location.hash === '#' + routeId) updateFromLocation(true);
            else window.location.hash = routeId;
        });
    });

    document.querySelector('[data-mobile-nav-toggle]')?.addEventListener('click', () => {
        setMobileNavigation(shell, !shell.classList.contains('is-mobile-nav-open'));
    });
    document.querySelector('[data-mobile-nav-close]')?.addEventListener('click', () => {
        setMobileNavigation(shell, false);
    });
    window.addEventListener('hashchange', () => updateFromLocation(true));
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setMobileNavigation(shell, false);
    });

    if (!window.location.hash) window.history.replaceState(null, '', '#dashboard');
    updateFromLocation(false);
}
