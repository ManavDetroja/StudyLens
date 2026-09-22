import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeTags,
    normalizeTagArray,
    validateTags,
    collectAllTags,
    MAX_TAGS_PER_RESOURCE,
    MAX_TAG_LENGTH,
} from '../js/utils/tagUtils.js';

/* ── normalizeTags (from comma string) ───────────────────────────── */

test('normalizes a comma-separated tag string', () => {
    assert.deepEqual(normalizeTags('Java, OOP, inheritance'), ['java', 'oop', 'inheritance']);
});

test('trims whitespace from tags', () => {
    assert.deepEqual(normalizeTags('  react ,  css  , html '), ['react', 'css', 'html']);
});

test('removes empty tags', () => {
    assert.deepEqual(normalizeTags('a,,b,,,c'), ['a', 'b', 'c']);
});

test('normalizes to lowercase', () => {
    assert.deepEqual(normalizeTags('Java, PYTHON, TypeScript'), ['java', 'python', 'typescript']);
});

test('removes duplicates after case normalization', () => {
    assert.deepEqual(normalizeTags('Java, OOP, inheritance, java, OOP'), ['java', 'oop', 'inheritance']);
});

test('returns empty array for non-string input', () => {
    assert.deepEqual(normalizeTags(null), []);
    assert.deepEqual(normalizeTags(undefined), []);
    assert.deepEqual(normalizeTags(42), []);
});

test('returns empty array for empty string', () => {
    assert.deepEqual(normalizeTags(''), []);
    assert.deepEqual(normalizeTags('   '), []);
    assert.deepEqual(normalizeTags(',,,'), []);
});

test('preserves meaningful tag names after normalization', () => {
    assert.deepEqual(normalizeTags('machine-learning, data_science, web 2.0'), ['machine-learning', 'data_science', 'web 2.0']);
});

/* ── normalizeTagArray (from existing array) ─────────────────────── */

test('normalizes an array of tags', () => {
    assert.deepEqual(normalizeTagArray(['Java', 'OOP', 'java']), ['java', 'oop']);
});

test('handles non-array input', () => {
    assert.deepEqual(normalizeTagArray(null), []);
    assert.deepEqual(normalizeTagArray('string'), []);
});

test('handles non-string elements in array', () => {
    assert.deepEqual(normalizeTagArray(['valid', 42, null, 'Also Valid']), ['valid', 'also valid']);
});

/* ── validateTags ────────────────────────────────────────────────── */

test('accepts valid tag array', () => {
    assert.doesNotThrow(() => validateTags(['java', 'oop']));
});

test('accepts empty tag array', () => {
    assert.doesNotThrow(() => validateTags([]));
});

test('rejects non-array input', () => {
    assert.throws(() => validateTags('not-array'), { code: 'TAGS_INVALID_TYPE' });
});

test('rejects too many tags', () => {
    const tooMany = Array.from({ length: MAX_TAGS_PER_RESOURCE + 1 }, (_, i) => 'tag' + i);
    assert.throws(() => validateTags(tooMany), { code: 'TAGS_TOO_MANY' });
});

test('accepts exactly MAX_TAGS_PER_RESOURCE tags', () => {
    const maxTags = Array.from({ length: MAX_TAGS_PER_RESOURCE }, (_, i) => 'tag' + i);
    assert.doesNotThrow(() => validateTags(maxTags));
});

test('rejects tags longer than MAX_TAG_LENGTH', () => {
    const longTag = 'a'.repeat(MAX_TAG_LENGTH + 1);
    assert.throws(() => validateTags([longTag]), { code: 'TAG_TOO_LONG' });
});

test('accepts tag at exactly MAX_TAG_LENGTH', () => {
    const exactTag = 'a'.repeat(MAX_TAG_LENGTH);
    assert.doesNotThrow(() => validateTags([exactTag]));
});

test('rejects empty-string tags', () => {
    assert.throws(() => validateTags(['']), { code: 'TAG_EMPTY' });
    assert.throws(() => validateTags(['   ']), { code: 'TAG_EMPTY' });
});

test('rejects non-string tag elements', () => {
    assert.throws(() => validateTags([42]), { code: 'TAG_EMPTY' });
});

/* ── collectAllTags ──────────────────────────────────────────────── */

test('collects unique sorted tags from resources', () => {
    const resources = [
        { tags: ['java', 'oop'] },
        { tags: ['python', 'oop'] },
        { tags: ['html'] },
    ];
    assert.deepEqual(collectAllTags(resources), ['html', 'java', 'oop', 'python']);
});

test('handles resources with no tags', () => {
    const resources = [
        { tags: [] },
        { tags: ['java'] },
        { tags: null },
    ];
    assert.deepEqual(collectAllTags(resources), ['java']);
});

test('handles empty resource array', () => {
    assert.deepEqual(collectAllTags([]), []);
});

test('normalizes mixed-case tags during collection', () => {
    const resources = [
        { tags: ['Java', 'OOP'] },
        { tags: ['java', 'python'] },
    ];
    assert.deepEqual(collectAllTags(resources), ['java', 'oop', 'python']);
});

test('limits are reasonable', () => {
    assert.equal(MAX_TAGS_PER_RESOURCE, 20);
    assert.equal(MAX_TAG_LENGTH, 50);
});
