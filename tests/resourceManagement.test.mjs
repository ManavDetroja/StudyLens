import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getResourceTypePresentation,
    formatFileOrSourceSummary,
    formatResourceDateContext,
    getResourceCounts,
    getAllResourceCounts,
} from '../js/features/resourceMetadata.js';

import {
    buildSearchableText,
    filterByStatus,
    applyLibraryFilters,
} from '../js/algorithms/librarySearch.js';

test('1. getResourceTypePresentation returns distinct presentation for each type', () => {
    const textPres = getResourceTypePresentation('text');
    assert.equal(textPres.label, 'Text');
    assert.equal(textPres.toneClass, 'tone-blue');
    assert.ok(textPres.iconSvg.includes('<svg'));

    const pdfPres = getResourceTypePresentation('pdf');
    assert.equal(pdfPres.label, 'PDF');
    assert.equal(pdfPres.toneClass, 'tone-rose');
    assert.ok(pdfPres.iconSvg.includes('<svg'));

    const imagePres = getResourceTypePresentation('image');
    assert.equal(imagePres.label, 'Image');
    assert.equal(imagePres.toneClass, 'tone-amber');
    assert.ok(imagePres.iconSvg.includes('<svg'));

    const videoPres = getResourceTypePresentation('video');
    assert.equal(videoPres.label, 'Video');
    assert.equal(videoPres.toneClass, 'tone-violet');
    assert.ok(videoPres.iconSvg.includes('<svg'));

    // Unknown type falls back safely to text
    const unknownPres = getResourceTypePresentation('unknown');
    assert.equal(unknownPres.label, 'Text');
    assert.equal(unknownPres.toneClass, 'tone-blue');
});

test('2. formatFileOrSourceSummary formats human-friendly descriptions for all resource kinds', () => {
    // PDF with filename and size
    const pdfRes = {
        type: 'pdf',
        metadata: { originalFileName: 'lecture_01.pdf', fileSize: 1024 * 1024 * 2 },
    };
    assert.equal(formatFileOrSourceSummary(pdfRes), 'lecture_01.pdf (2.0 MB)');

    // PDF without filename
    const pdfUnnamed = {
        type: 'pdf',
        metadata: { fileSize: 512 * 1024 },
    };
    assert.equal(formatFileOrSourceSummary(pdfUnnamed), 'PDF Document (512.0 KB)');

    // Image with filename and size
    const imgRes = {
        type: 'image',
        metadata: { originalFileName: 'cell_diagram.png', fileSize: 150 * 1024 },
    };
    assert.equal(formatFileOrSourceSummary(imgRes), 'cell_diagram.png (150.0 KB)');

    // Image without filename
    const imgUnnamed = {
        type: 'image',
        metadata: {},
    };
    assert.equal(formatFileOrSourceSummary(imgUnnamed), 'Image File');

    // Video with YouTube video ID
    const videoRes = {
        type: 'video',
        metadata: { videoId: 'dQw4w9WgXcQ' },
    };
    assert.equal(formatFileOrSourceSummary(videoRes), 'YouTube · dQw4w9WgXcQ');

    // Video without videoId but with youtube source URL
    const videoUrlRes = {
        type: 'video',
        source: 'https://www.youtube.com/watch?v=123',
    };
    assert.equal(formatFileOrSourceSummary(videoUrlRes), 'YouTube Video');

    // Video fallback
    const videoFallback = {
        type: 'video',
    };
    assert.equal(formatFileOrSourceSummary(videoFallback), 'Video');

    // Text resource
    const textRes = {
        type: 'text',
        source: 'manual://text-entry',
    };
    assert.equal(formatFileOrSourceSummary(textRes), 'Manual text');

    // Null or undefined resource
    assert.equal(formatFileOrSourceSummary(null), '');
});

test('3. formatResourceDateContext differentiates created vs updated timestamps accurately', () => {
    const createdTime = '2026-05-10T10:00:00.000Z';

    // Same time or missing updatedAt returns Created
    const res1 = formatResourceDateContext(createdTime, createdTime);
    assert.ok(res1.startsWith('Created '));

    const res2 = formatResourceDateContext(createdTime);
    assert.ok(res2.startsWith('Created '));

    // Minor update within 30 seconds remains Created
    const minorUpdate = '2026-05-10T10:00:30.000Z';
    assert.ok(formatResourceDateContext(createdTime, minorUpdate).startsWith('Created '));

    // Meaningful update (> 1 minute later) reports Updated
    const laterUpdate = '2026-05-10T12:00:00.000Z';
    const res3 = formatResourceDateContext(createdTime, laterUpdate);
    assert.ok(res3.startsWith('Updated '));

    // Invalid timestamp returns Unknown date
    assert.equal(formatResourceDateContext('not-a-date'), 'Unknown date');
});

test('4. buildSearchableText indexes source, original filename, and video ID', () => {
    const pdfResource = {
        id: 'res-pdf-1',
        title: 'Biology Chapter 1',
        content: 'Mitochondria is powerhouse',
        tags: ['biology'],
        source: 'local://file-import',
        metadata: {
            originalFileName: 'mitochondria_study_guide.pdf',
        },
    };

    const searchable = buildSearchableText(pdfResource);
    assert.ok(searchable.includes('biology chapter 1'));
    assert.ok(searchable.includes('mitochondria_study_guide.pdf'));
    assert.ok(searchable.includes('mitochondria is powerhouse'));

    // Searching by original filename
    const searchByName = applyLibraryFilters([pdfResource], { query: 'study_guide' });
    assert.equal(searchByName.length, 1);
    assert.equal(searchByName[0].id, 'res-pdf-1');

    // Video resource searchable by videoId
    const videoResource = {
        id: 'res-vid-1',
        title: 'Quantum Mechanics',
        content: null,
        tags: ['physics'],
        source: 'https://www.youtube.com/watch?v=qm_abc123',
        metadata: {
            videoId: 'qm_abc123',
        },
    };

    const searchByVidId = applyLibraryFilters([videoResource], { query: 'qm_abc123' });
    assert.equal(searchByVidId.length, 1);
    assert.equal(searchByVidId[0].id, 'res-vid-1');
});

test('5. filterByStatus supports live queue effective status callback including queued and stalled', () => {
    const resources = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'processing' },
        { id: '3', status: 'completed' },
        { id: '4', status: 'failed' },
    ];

    // Static status filtering without callback
    assert.equal(filterByStatus(resources, 'completed').length, 1);
    assert.equal(filterByStatus(resources, 'pending').length, 1);
    assert.equal(filterByStatus(resources, 'all').length, 4);

    // Live queue callback where resource '1' is actually queued
    const getEffectiveStatus = (res) => {
        if (res.id === '1') return 'queued';
        if (res.id === '4') return 'stalled';
        return res.status;
    };

    const queuedFiltered = filterByStatus(resources, 'queued', getEffectiveStatus);
    assert.equal(queuedFiltered.length, 1);
    assert.equal(queuedFiltered[0].id, '1');

    // Stalled maps to failed in filter
    const failedFiltered = filterByStatus(resources, 'failed', getEffectiveStatus);
    assert.equal(failedFiltered.length, 1);
    assert.equal(failedFiltered[0].id, '4');
});

test('6. getResourceCounts safely handles empty or non-string resource IDs', async () => {
    const counts = await getResourceCounts('');
    assert.equal(counts.learningOutputsCount, 0);
    assert.equal(counts.flashcardsCount, 0);
    assert.equal(counts.quizzesCount, 0);
    assert.equal(counts.attemptsCount, 0);
    assert.equal(counts.notesCount, 0);
    assert.equal(counts.chunksCount, 0);
    assert.equal(counts.hasProcessedContent, false);

    const countsNull = await getResourceCounts(null);
    assert.equal(countsNull.learningOutputsCount, 0);
});

test('7. getAllResourceCounts initializes all resources in map even when empty', async () => {
    const resources = [
        { id: 'res-a' },
        { id: 'res-b' },
    ];

    const countsMap = await getAllResourceCounts(resources);
    assert.equal(countsMap.size, 2);
    assert.ok(countsMap.has('res-a'));
    assert.ok(countsMap.has('res-b'));
    assert.equal(countsMap.get('res-a').learningOutputsCount, 0);
    assert.equal(countsMap.get('res-b').flashcardsCount, 0);

    const emptyMap = await getAllResourceCounts([]);
    assert.equal(emptyMap.size, 0);
});
