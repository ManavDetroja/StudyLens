import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTextContent } from '../js/processing/textNormalizer.js';

test('normalizes CRLF line endings, horizontal whitespace, blank lines, and document edges', () => {
    const content = ' \r\n  First\t\tparagraph  \r\n \r\n\r\n Second   paragraph  \r\n ';

    assert.equal(
        normalizeTextContent(content),
        'First paragraph\n\nSecond paragraph',
    );
});

test('retains line and paragraph boundaries while normalizing text', () => {
    const content = 'First line\r\nSecond line\r\n\r\nThird\t line';

    assert.equal(
        normalizeTextContent(content),
        'First line\nSecond line\n\nThird line',
    );
});

test('normalizes whitespace-only content to an empty string', () => {
    assert.equal(normalizeTextContent(' \r\n\t \r\n  '), '');
});

test('rejects non-string text content', () => {
    assert.throws(
        () => normalizeTextContent(null),
        { code: 'INVALID_TEXT_CONTENT' },
    );
});
