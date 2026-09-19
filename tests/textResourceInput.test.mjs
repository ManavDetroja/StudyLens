import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createTextResourceInput,
    createTextResourceUpdate,
    normalizeTextResourceTags,
    validateTextResourceInput,
} from '../js/features/textResourceInput.js';

test('normalizes comma-separated text resource tags', () => {
    assert.deepEqual(
        normalizeTextResourceTags(' java, inheritance, , oop, java,  oop  '),
        ['java', 'inheritance', 'oop'],
    );
});

test('creates completed manual text-resource input with trimmed fields', () => {
    const input = createTextResourceInput({
        title: '  Java inheritance  ',
        content: '  A subclass can inherit from a superclass.  ',
        tags: 'java, oop, java',
    });

    assert.deepEqual(input, {
        title: 'Java inheritance',
        content: 'A subclass can inherit from a superclass.',
        tags: ['java', 'oop'],
        type: 'text',
        source: 'manual://text-entry',
        status: 'completed',
        metadata: { entryMethod: 'manual' },
    });
});

test('rejects empty text-resource titles and content', () => {
    assert.throws(
        () => validateTextResourceInput({ title: '   ', content: 'content', tags: '' }),
        /Enter a title/,
    );
    assert.throws(
        () => createTextResourceUpdate({ title: 'Title', content: '   ', tags: '' }),
        /Enter text content/,
    );
});
