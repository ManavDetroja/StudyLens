export const routes = Object.freeze([
    { id: 'dashboard', title: 'Dashboard', description: 'Your learning workspace at a glance.' },
    { id: 'library', title: 'Library', description: 'Your collection of learning resources.' },
    { id: 'notes', title: 'Notes', description: 'Capture ideas and review key takeaways.' },
    { id: 'flashcards', title: 'Flashcards', description: 'Build confidence through active recall.' },
    { id: 'quizzes', title: 'Quizzes', description: 'Check your understanding with practice.' },
    { id: 'analytics', title: 'Analytics', description: 'Review learning activity when data is available.' },
    { id: 'settings', title: 'Settings', description: 'Manage future StudyLens preferences.' },
]);

export function getRoute(routeId) {
    return routes.find((route) => route.id === routeId) ?? routes[0];
}

export function getRouteFromHash(hash) {
    return getRoute(hash.replace(/^#/, '').trim());
}
