import test from 'node:test';
import assert from 'node:assert/strict';

import {
    validateNote,
    createNoteRecord,
    createUpdatedNoteRecord,
    generateNoteId,
    NOTE_TITLE_MAX_LENGTH,
    NOTE_CONTENT_MAX_LENGTH,
} from '../js/storage/noteValidation.js';
import { NoteValidationError } from '../js/storage/errors.js';
import {
    createNote,
    getNote,
    getAllNotes,
    getNotesByResource,
    updateNote,
    deleteNote,
    deleteNotesForResource,
    countNotes,
    normalizeSearchQuery,
    buildNoteSearchableText,
    searchNotes,
    filterNotesByResource,
    filterAndSearchNotes,
} from '../js/features/noteService.js';
import { onNotesChanged } from '../js/core/resourceEvents.js';
import { createNoteCard } from '../js/features/notesPage.js';

/* ── Minimal In-Memory Mock Repository ───────────────────────────── */

function createMockNoteRepository() {
    const store = new Map();

    return {
        _store: store,
        async createNote(input) {
            const note = createNoteRecord(input);
            store.set(note.id, { ...note });
            return { ...note };
        },
        async getNote(id) {
            const note = store.get(id);
            return note ? { ...note } : null;
        },
        async getAllNotes() {
            return Array.from(store.values())
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map((n) => ({ ...n }));
        },
        async getNotesByResource(resourceId) {
            return Array.from(store.values())
                .filter((n) => n.resourceId === resourceId)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map((n) => ({ ...n }));
        },
        async updateNote(id, patch) {
            const existing = store.get(id);
            if (!existing) throw new NoteValidationError('Note not found');
            const updated = createUpdatedNoteRecord(existing, patch);
            store.set(id, { ...updated });
            return { ...updated };
        },
        async deleteNote(id) {
            return store.delete(id);
        },
        async deleteNotesByResource(resourceId) {
            let count = 0;
            for (const [id, note] of Array.from(store.entries())) {
                if (note.resourceId === resourceId) {
                    store.delete(id);
                    count++;
                }
            }
            return count;
        },
        async countNotes() {
            return store.size;
        },
        async clearNotes() {
            const size = store.size;
            store.clear();
            return size;
        },
    };
}

/* ── Minimal Mock DOM for Node tests ─────────────────────────────── */

function setupMockDocument() {
    function createMockElement(tagName) {
        const listeners = new Map();
        return {
            tagName: tagName.toUpperCase(),
            className: '',
            textContent: '',
            title: '',
            hidden: false,
            disabled: false,
            dataset: {},
            attributes: {},
            children: [],
            addEventListener(event, fn) {
                if (!listeners.has(event)) listeners.set(event, []);
                listeners.get(event).push(fn);
            },
            dispatchEvent(event) {
                const handlers = listeners.get(event.type) || [];
                handlers.forEach((h) => h(event));
            },
            setAttribute(name, value) {
                this.attributes[name] = String(value);
            },
            getAttribute(name) {
                return this.attributes[name] ?? null;
            },
            appendChild(child) {
                this.children.push(child);
                return child;
            },
            querySelector(selector) {
                return this.querySelectorAll(selector)[0] ?? null;
            },
            querySelectorAll(selector) {
                const res = [];
                function traverse(node) {
                    for (const ch of node.children) {
                        if (selector.startsWith('.') && ch.className.split(/\s+/).includes(selector.slice(1))) {
                            res.push(ch);
                        } else if (selector.startsWith('[') && selector.endsWith(']')) {
                            const attr = selector.slice(1, -1);
                            if (ch.attributes[attr] !== undefined || (attr.startsWith('data-') && ch.dataset[attr.slice(5)] !== undefined)) {
                                res.push(ch);
                            }
                        } else if (ch.tagName.toLowerCase() === selector.toLowerCase()) {
                            res.push(ch);
                        }
                        traverse(ch);
                    }
                }
                traverse(this);
                return res;
            },
        };
    }

    globalThis.document = {
        createElement(tagName) {
            return createMockElement(tagName);
        },
    };
}

/* ── Test Cases (1 to 24) ────────────────────────────────────────── */

test('1. validateNote accepts valid note with all fields', () => {
    const validNote = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        resourceId: 'res-bio-1',
        title: 'Cellular Respiration Notes',
        content: 'Overview of glycolysis, Krebs cycle, and oxidative phosphorylation.',
        tags: ['biology', 'respiration', 'cells'],
        metadata: { wordCount: 10 },
        createdAt: '2026-09-26T10:00:00.000Z',
        updatedAt: '2026-09-26T10:30:00.000Z',
    };

    assert.doesNotThrow(() => validateNote(validNote));
    const result = validateNote(validNote);
    assert.equal(result.id, validNote.id);
    assert.equal(result.resourceId, 'res-bio-1');
    assert.equal(result.title, 'Cellular Respiration Notes');
});

test('2. validateNote accepts note with resourceId: null (standalone note)', () => {
    const standaloneNote = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        resourceId: null,
        title: 'Quick Study Plan',
        content: '1. Review physics\n2. Solve practice problems',
        tags: ['study-plan'],
        metadata: {},
        createdAt: '2026-09-26T10:00:00.000Z',
        updatedAt: '2026-09-26T10:00:00.000Z',
    };

    assert.doesNotThrow(() => validateNote(standaloneNote));
    const result = validateNote(standaloneNote);
    assert.equal(result.resourceId, null);
});

test('3. validateNote rejects missing or invalid id', () => {
    assert.throws(
        () => validateNote({
            id: '',
            resourceId: null,
            title: 'Title',
            content: 'Content',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        NoteValidationError,
    );

    assert.throws(
        () => validateNote({
            id: null,
            resourceId: null,
            title: 'Title',
            content: 'Content',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        NoteValidationError,
    );
});

test('4. validateNote rejects missing, empty, or whitespace-only title', () => {
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: '   ',
            content: 'Content',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /title must be a non-empty string/i,
    );

    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            content: 'Content',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /title must be a non-empty string/i,
    );
});

test('5. validateNote rejects title exceeding NOTE_TITLE_MAX_LENGTH (200)', () => {
    const longTitle = 'a'.repeat(NOTE_TITLE_MAX_LENGTH + 1);
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: longTitle,
            content: 'Content',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /must not exceed/i,
    );
});

test('6. validateNote rejects missing, empty, or whitespace-only content', () => {
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            content: '   \n  \t ',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /content must be a non-empty string/i,
    );

    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /content must be a non-empty string/i,
    );
});

test('7. validateNote rejects content exceeding NOTE_CONTENT_MAX_LENGTH (100000)', () => {
    const longContent = 'x'.repeat(NOTE_CONTENT_MAX_LENGTH + 1);
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            content: longContent,
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /must not exceed/i,
    );
});

test('8. validateNote rejects invalid tags (non-array, exceeding limits)', () => {
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            content: 'Content',
            tags: 'not-an-array',
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        NoteValidationError,
    );

    const tooManyTags = Array.from({ length: 35 }, (_, i) => `tag${i}`);
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            content: 'Content',
            tags: tooManyTags,
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        NoteValidationError,
    );
});

test('9. validateNote rejects invalid timestamps', () => {
    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            content: 'Content',
            tags: [],
            createdAt: 'not-a-date',
            updatedAt: '2026-09-26T10:00:00.000Z',
        }),
        /must be an ISO timestamp/i,
    );

    assert.throws(
        () => validateNote({
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Title',
            content: 'Content',
            tags: [],
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: 'invalid',
        }),
        /must be an ISO timestamp/i,
    );
});

test('10. createNoteRecord creates valid note with generated UUID and valid ISO timestamps', () => {
    const note = createNoteRecord({
        title: 'Mechanics Summary',
        content: 'F = ma, action and reaction are equal and opposite.',
        resourceId: 'res-phys-1',
    });

    assert.ok(typeof note.id === 'string' && note.id.length > 0);
    assert.equal(note.title, 'Mechanics Summary');
    assert.equal(note.content, 'F = ma, action and reaction are equal and opposite.');
    assert.equal(note.resourceId, 'res-phys-1');
    assert.deepEqual(note.tags, []);
    assert.ok(note.createdAt);
    assert.ok(note.updatedAt);
    assert.doesNotThrow(() => validateNote(note));
});

test('11. createNoteRecord normalizes string or array tags into deduplicated, lowercase tags', () => {
    const noteWithStringTags = createNoteRecord({
        title: 'Chemistry Note',
        content: 'Acids and bases neutralisation.',
        tags: ' Chemistry, ACID, chemistry, Base , acid ',
    });

    assert.deepEqual(noteWithStringTags.tags, ['chemistry', 'acid', 'base']);

    const noteWithArrayTags = createNoteRecord({
        title: 'Chemistry Note 2',
        content: 'Redox reactions.',
        tags: [' REDOX ', 'Oxidation', 'redox'],
    });

    assert.deepEqual(noteWithArrayTags.tags, ['redox', 'oxidation']);
});

test('12. createUpdatedNoteRecord preserves immutable id and createdAt while updating updatedAt', () => {
    const original = createNoteRecord({
        title: 'Original Title',
        content: 'Original content.',
        resourceId: 'res-orig',
        tags: ['tag1'],
    });

    const updated = createUpdatedNoteRecord(original, {
        title: 'Updated Title',
        content: 'Updated content.',
        tags: ['tag1', 'tag2'],
    });

    assert.equal(updated.id, original.id);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.title, 'Updated Title');
    assert.equal(updated.content, 'Updated content.');
    assert.deepEqual(updated.tags, ['tag1', 'tag2']);
    assert.ok(updated.updatedAt);
});

test('13. createUpdatedNoteRecord rejects attempts to modify immutable fields (id, createdAt)', () => {
    const original = createNoteRecord({
        title: 'Test Note',
        content: 'Content',
    });

    assert.throws(
        () => createUpdatedNoteRecord(original, {
            id: 'tampered-id',
            title: 'New Title',
        }),
        /immutable and cannot be modified/i,
    );

    assert.throws(
        () => createUpdatedNoteRecord(original, {
            createdAt: '2020-01-01T00:00:00.000Z',
            title: 'New Title',
        }),
        /immutable and cannot be modified/i,
    );
});

test('14. normalizeSearchQuery trims whitespace, replaces multiple spaces, and converts to lowercase', () => {
    assert.equal(normalizeSearchQuery('   HELLO    WORLD   '), 'hello world');
    assert.equal(normalizeSearchQuery('Biology \t \n Chapter 1'), 'biology chapter 1');
    assert.equal(normalizeSearchQuery(null), '');
    assert.equal(normalizeSearchQuery(undefined), '');
});

test('15. buildNoteSearchableText combines title, content, and tags into normalized string', () => {
    const note = {
        title: 'Photosynthesis Lab',
        content: 'Testing chlorophyll absorption with spinach leaves.',
        tags: ['biology', 'chlorophyll'],
    };

    const searchable = buildNoteSearchableText(note);
    assert.ok(searchable.includes('photosynthesis lab'));
    assert.ok(searchable.includes('spinach leaves'));
    assert.ok(searchable.includes('biology'));
});

test('16. searchNotes returns matching notes for query matching title, content, or tag substring (case-insensitive)', () => {
    const notes = [
        { id: '1', title: 'Calculus Derivatives', content: 'Power rule and chain rule.', tags: ['math'] },
        { id: '2', title: 'Biology Cells', content: 'Mitochondria is powerhouse.', tags: ['biology'] },
        { id: '3', title: 'World History', content: 'Industrial revolution in Britain.', tags: ['history', 'calculus'] },
    ];

    // Search by title substring
    const res1 = searchNotes(notes, 'calculus');
    assert.equal(res1.length, 2); // note 1 (title) and note 3 (tag)

    // Search by content substring
    const res2 = searchNotes(notes, 'mitochondria');
    assert.equal(res2.length, 1);
    assert.equal(res2[0].id, '2');

    // Search by tag
    const res3 = searchNotes(notes, 'math');
    assert.equal(res3.length, 1);
    assert.equal(res3[0].id, '1');

    // Case insensitivity
    const res4 = searchNotes(notes, 'BRITAIN');
    assert.equal(res4.length, 1);
    assert.equal(res4[0].id, '3');
});

test('17. searchNotes returns all notes when query is empty', () => {
    const notes = [
        { id: '1', title: 'Note 1', content: 'A', tags: [] },
        { id: '2', title: 'Note 2', content: 'B', tags: [] },
    ];

    assert.equal(searchNotes(notes, '').length, 2);
    assert.equal(searchNotes(notes, '   ').length, 2);
});

test('18. filterNotesByResource returns all notes when filter is "all"', () => {
    const notes = [
        { id: '1', resourceId: null, title: 'Standalone', content: 'A' },
        { id: '2', resourceId: 'res-1', title: 'Linked', content: 'B' },
    ];

    assert.equal(filterNotesByResource(notes, 'all').length, 2);
});

test('19. filterNotesByResource returns only notes with resourceId === null when filter is "standalone"', () => {
    const notes = [
        { id: '1', resourceId: null, title: 'Standalone 1', content: 'A' },
        { id: '2', resourceId: 'res-1', title: 'Linked', content: 'B' },
        { id: '3', resourceId: null, title: 'Standalone 2', content: 'C' },
    ];

    const standalone = filterNotesByResource(notes, 'standalone');
    assert.equal(standalone.length, 2);
    assert.ok(standalone.every((n) => n.resourceId === null));
});

test('20. filterNotesByResource returns notes matching specific resourceId', () => {
    const notes = [
        { id: '1', resourceId: 'res-1', title: 'Res 1 Note', content: 'A' },
        { id: '2', resourceId: 'res-2', title: 'Res 2 Note', content: 'B' },
        { id: '3', resourceId: 'res-1', title: 'Another Res 1 Note', content: 'C' },
    ];

    const res1Notes = filterNotesByResource(notes, 'res-1');
    assert.equal(res1Notes.length, 2);
    assert.ok(res1Notes.every((n) => n.resourceId === 'res-1'));
});

test('21. filterAndSearchNotes combines resource filter and search query correctly', () => {
    const notes = [
        { id: '1', resourceId: 'res-1', title: 'Photosynthesis Lecture', content: 'Calvin cycle', tags: ['bio'] },
        { id: '2', resourceId: 'res-2', title: 'Photosynthesis Reading', content: 'Light reactions', tags: ['bio'] },
        { id: '3', resourceId: null, title: 'Photosynthesis Ideas', content: 'Plant experiments', tags: ['bio'] },
    ];

    // Filter by res-1 AND search "calvin"
    const matched = filterAndSearchNotes(notes, { query: 'calvin', resourceId: 'res-1' });
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, '1');

    // Filter by standalone AND search "photosynthesis"
    const standaloneMatch = filterAndSearchNotes(notes, { query: 'photosynthesis', resourceId: 'standalone' });
    assert.equal(standaloneMatch.length, 1);
    assert.equal(standaloneMatch[0].id, '3');
});

test('22. createNote and deleteNote fire noteschanged events with correct action and payload', async () => {
    const repo = createMockNoteRepository();
    const events = [];

    const unsubscribe = onNotesChanged((event) => {
        events.push(event);
    });

    try {
        const created = await createNote({
            title: 'Event Test Note',
            content: 'Testing event emission.',
            resourceId: 'res-event-1',
        }, { repo });

        assert.equal(events.length, 1);
        assert.equal(events[0].action, 'created');
        assert.equal(events[0].noteId, created.id);
        assert.equal(events[0].resourceId, 'res-event-1');

        await deleteNote(created.id, { repo });

        assert.equal(events.length, 2);
        assert.equal(events[1].action, 'deleted');
        assert.equal(events[1].noteId, created.id);
    } finally {
        unsubscribe();
    }
});

test('23. Safe rendering: createNoteCard sets title, content preview, and tags using textContent', () => {
    setupMockDocument();

    const maliciousNote = {
        id: 'note-xss-1',
        resourceId: 'res-1',
        title: '<script>alert("xss-title")</script>',
        content: '<img src="x" onerror="alert(\'xss-content\')" />',
        tags: ['<script>alert("tag")</script>'],
        createdAt: '2026-09-26T10:00:00.000Z',
        updatedAt: '2026-09-26T10:00:00.000Z',
    };

    const resourceMap = new Map([['res-1', '<b onmouseover="alert(\'res\')">Biology</b>']]);
    const card = createNoteCard(maliciousNote, resourceMap);

    const titleEl = card.querySelector('.note-card-title');
    const previewEl = card.querySelector('.note-card-preview');
    const tagEl = card.querySelector('.resource-tag');
    const badgeEl = card.querySelector('.note-resource-badge');

    // Elements must contain the exact literal string via textContent, never interpreted as HTML tags
    assert.equal(titleEl.textContent, '<script>alert("xss-title")</script>');
    assert.equal(previewEl.textContent, '<img src="x" onerror="alert(\'xss-content\')" />');
    assert.equal(tagEl.textContent, '<script>alert("tag")</script>');
    assert.equal(badgeEl.textContent, '<b onmouseover="alert(\'res\')">Biology</b>');

    // Title and preview elements should not have children nodes (like script or img elements)
    assert.equal(titleEl.children.length, 0);
    assert.equal(previewEl.children.length, 0);
});

test('24. deleteNotesForResource cleans up notes associated with a resource', async () => {
    const repo = createMockNoteRepository();

    await repo.createNote({ title: 'Res A Note 1', content: 'Content', resourceId: 'res-A' });
    await repo.createNote({ title: 'Res A Note 2', content: 'Content', resourceId: 'res-A' });
    await repo.createNote({ title: 'Res B Note 1', content: 'Content', resourceId: 'res-B' });
    await repo.createNote({ title: 'Standalone', content: 'Content', resourceId: null });

    assert.equal(await repo.countNotes(), 4);

    const deletedCount = await deleteNotesForResource('res-A', { repo });
    assert.equal(deletedCount, 2);

    assert.equal(await repo.countNotes(), 2);
    const remaining = await repo.getAllNotes();
    assert.ok(remaining.every((n) => n.resourceId !== 'res-A'));
});
