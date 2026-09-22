import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_MAX_CHUNK_SIZE,
    chunkNormalizedContent,
} from '../js/processing/contentChunker.js';

test('chunks text at paragraph boundaries when they fit the configured maximum', () => {
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const segments = chunkNormalizedContent(content, { maxChunkSize: 20 });

    assert.deepEqual(segments.map((segment) => segment.text), [
        'First paragraph.\n\n',
        'Second paragraph.\n\n',
        'Third paragraph.',
    ]);
});

test('keeps every chunk ordered, contiguous, within the maximum, and lossless', () => {
    const content = 'A short paragraph.\n\nA second paragraph that is deliberately longer.\n\nFinal paragraph.';
    const maxChunkSize = 18;
    const segments = chunkNormalizedContent(content, { maxChunkSize });

    assert.ok(segments.length > 1);
    assert.ok(segments.every((segment) => segment.text.length <= maxChunkSize));
    assert.deepEqual(segments.map((segment) => segment.index), segments.map((_, index) => index));
    assert.equal(segments[0].startOffset, 0);
    assert.equal(segments.at(-1).endOffset, content.length);
    assert.ok(segments.every((segment, index) => (
        index === 0 || segment.startOffset === segments[index - 1].endOffset
    )));
    assert.equal(segments.map((segment) => segment.text).join(''), content);
});

test('uses a deterministic hard split for text without a paragraph or line boundary', () => {
    const segments = chunkNormalizedContent('abcdefghijk', { maxChunkSize: 4 });

    assert.deepEqual(segments.map((segment) => segment.text), ['abcd', 'efgh', 'ijk']);
});

test('returns no segments for empty normalized text and rejects invalid maximums', () => {
    assert.deepEqual(chunkNormalizedContent(''), []);
    assert.equal(DEFAULT_MAX_CHUNK_SIZE, 1200);
    assert.throws(
        () => chunkNormalizedContent('content', { maxChunkSize: 0 }),
        { code: 'INVALID_CHUNK_SIZE' },
    );
});
