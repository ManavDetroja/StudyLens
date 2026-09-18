import test from 'node:test';
import assert from 'node:assert/strict';
import { getRouteFromHash, routes } from '../js/core/routes.js';

test('route registry exposes every StudyLens page', () => {
    assert.deepEqual(
        routes.map((route) => route.id),
        ['dashboard', 'library', 'notes', 'flashcards', 'quizzes', 'analytics', 'settings'],
    );
});

test('hash navigation resolves known routes and falls back to dashboard', () => {
    assert.equal(getRouteFromHash('#flashcards').id, 'flashcards');
    assert.equal(getRouteFromHash('#not-a-route').id, 'dashboard');
    assert.equal(getRouteFromHash('').id, 'dashboard');
});
