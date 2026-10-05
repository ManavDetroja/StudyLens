import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseYouTubeUrl,
    isValidYouTubeUrl,
    extractYouTubeVideoId,
    buildCanonicalYouTubeUrl,
    buildYouTubeEmbedUrl,
    buildYouTubeThumbnailUrl,
    YOUTUBE_VIDEO_ID_REGEX,
} from '../js/features/youtubeUrlValidator.js';

import {
    parseTimestampToSeconds,
    formatSecondsToTimestamp,
    parseTranscriptText,
} from '../js/processing/transcriptParser.js';

import {
    TranscriptProvider,
    defaultTranscriptProvider,
    TRANSCRIPT_STATUS,
} from '../js/processing/transcriptProvider.js';

import { videoAdapter } from '../js/processing/videoAdapter.js';
import { sourceAdapterRegistry, assertAdapterContract } from '../js/processing/sourceAdapterRegistry.js';
import { processResource } from '../js/processing/contentProcessingPipeline.js';
import { processAndStore } from '../js/features/processingIntegration.js';
import { generateLearningOutputs } from '../js/processing/learningOutputGenerator.js';
import { generateFlashcards } from '../js/processing/flashcardGenerator.js';
import { generateQuiz } from '../js/processing/quizGenerator.js';
import { createResourceRecord } from '../js/storage/resourceValidation.js';
import {
    SAMPLE_YOUTUBE_URLS,
    SAMPLE_TRANSCRIPT_RAW,
    SAMPLE_TRANSCRIPT_PLAIN,
    SAMPLE_TRANSCRIPT_SRT,
} from './helpers/testTranscriptFixture.mjs';

function createMockResourceRepository(initial = []) {
    const store = new Map(initial.map((r) => [r.id, { ...r }]));
    return {
        async getResource(id) {
            return store.get(id) ? { ...store.get(id) } : null;
        },
        async updateResource(id, updates) {
            const current = store.get(id);
            if (!current) throw new Error('Resource not found: ' + id);
            const updated = { ...current, ...updates, updatedAt: new Date().toISOString() };
            store.set(id, updated);
            return { ...updated };
        },
        async createResource(resource) {
            store.set(resource.id, { ...resource });
            return { ...resource };
        },
    };
}

function createMockProcessedContentRepository() {
    const store = new Map();
    return {
        async getByResourceId(resourceId) {
            return store.get(resourceId) ? { ...store.get(resourceId) } : null;
        },
        async saveProcessedContent(content) {
            const record = {
                id: content.id || 'proc-' + content.resourceId,
                resourceId: content.resourceId,
                normalizedText: content.text ?? '',
                chunks: (content.segments ?? []).map((s) => ({
                    id: s.id || `${content.resourceId}-chunk-${s.index}`,
                    index: s.index,
                    text: s.text,
                    startOffset: s.startOffset,
                    endOffset: s.endOffset,
                })),
                sourceType: content.sourceType ?? 'video',
                metadata: content.metadata ?? {},
                createdAt: content.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            store.set(record.resourceId, record);
            return record;
        },
        async deleteByResourceId(resourceId) {
            return store.delete(resourceId);
        },
    };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. YouTube URL Validation & Parsing Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('1. parseYouTubeUrl parses standard watch URLs', () => {
    const res = parseYouTubeUrl(SAMPLE_YOUTUBE_URLS.standardWatch);
    assert.equal(res.isValid, true);
    assert.equal(res.videoId, 'dQw4w9WgXcQ');
    assert.equal(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('2. parseYouTubeUrl parses youtu.be short URLs', () => {
    const res = parseYouTubeUrl(SAMPLE_YOUTUBE_URLS.shortUrl);
    assert.equal(res.isValid, true);
    assert.equal(res.videoId, 'dQw4w9WgXcQ');
    assert.equal(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('3. parseYouTubeUrl parses embed and shorts URLs', () => {
    const embedRes = parseYouTubeUrl(SAMPLE_YOUTUBE_URLS.embedUrl);
    assert.equal(embedRes.isValid, true);
    assert.equal(embedRes.videoId, 'dQw4w9WgXcQ');

    const shortsRes = parseYouTubeUrl(SAMPLE_YOUTUBE_URLS.shortsUrl);
    assert.equal(shortsRes.isValid, true);
    assert.equal(shortsRes.videoId, 'dQw4w9WgXcQ');
});

test('4. parseYouTubeUrl handles query parameters, channels, and timestamps safely', () => {
    const res = parseYouTubeUrl(SAMPLE_YOUTUBE_URLS.withQueryAndChannel);
    assert.equal(res.isValid, true);
    assert.equal(res.videoId, 'dQw4w9WgXcQ');
    assert.equal(res.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('5. parseYouTubeUrl trims whitespace and handles case insensitivity on domain', () => {
    const res = parseYouTubeUrl('   https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ   ');
    assert.equal(res.isValid, true);
    assert.equal(res.videoId, 'dQw4w9WgXcQ');
});

test('6. parseYouTubeUrl rejects non-YouTube URLs', () => {
    const res1 = parseYouTubeUrl('https://vimeo.com/123456789');
    assert.equal(res1.isValid, false);
    assert.equal(res1.code, 'UNSUPPORTED_VIDEO_HOST');

    const res2 = parseYouTubeUrl('https://fake-youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(res2.isValid, false);
});

test('7. parseYouTubeUrl rejects malformed URLs and dangerous protocols', () => {
    assert.equal(parseYouTubeUrl('').isValid, false);
    assert.equal(parseYouTubeUrl('not a url').isValid, false);
    assert.equal(parseYouTubeUrl('javascript:alert(1)').isValid, false);
    assert.equal(parseYouTubeUrl('file:///video.mp4').isValid, false);
    assert.equal(parseYouTubeUrl('https://youtube.com/watch?v=short').isValid, false); // < 11 chars
    assert.equal(parseYouTubeUrl('https://youtube.com/watch?v=toolongvideoidentifier123').isValid, false);
});

test('8. Helper builders construct safe canonical, embed, and thumbnail URLs', () => {
    const id = 'dQw4w9WgXcQ';
    assert.equal(buildCanonicalYouTubeUrl(id), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(buildYouTubeEmbedUrl(id), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    assert.equal(buildYouTubeThumbnailUrl(id, 'hqdefault'), 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.equal(extractYouTubeVideoId(SAMPLE_YOUTUBE_URLS.standardWatch), 'dQw4w9WgXcQ');
    assert.equal(isValidYouTubeUrl(SAMPLE_YOUTUBE_URLS.standardWatch), true);
    assert.equal(isValidYouTubeUrl('https://example.com'), false);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. Transcript Parser & Timestamp Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('9. parseTimestampToSeconds and formatSecondsToTimestamp handle conversions accurately', () => {
    assert.equal(parseTimestampToSeconds('00:00'), 0);
    assert.equal(parseTimestampToSeconds('01:30'), 90);
    assert.equal(parseTimestampToSeconds('01:02:03'), 3723);
    assert.equal(parseTimestampToSeconds('[02:15]'), 135);
    assert.equal(parseTimestampToSeconds('invalid'), null);

    assert.equal(formatSecondsToTimestamp(0), '00:00');
    assert.equal(formatSecondsToTimestamp(90), '01:30');
    assert.equal(formatSecondsToTimestamp(3723), '01:02:03');
});

test('10. parseTranscriptText parses timestamped lecture transcripts into segments', () => {
    const parsed = parseTranscriptText(SAMPLE_TRANSCRIPT_RAW);
    assert.equal(parsed.hasTimestamps, true);
    assert.ok(parsed.segments.length >= 6);
    assert.equal(parsed.segments[0].timestamp, '00:00');
    assert.equal(parsed.segments[0].startSeconds, 0);
    assert.ok(parsed.segments[0].text.includes('Object-Oriented Programming'));
    assert.ok(parsed.text.length > 100);
    assert.equal(parsed.metadata.hasTimestamps, true);
    assert.ok(parsed.metadata.totalDurationSeconds > 0);
});

test('11. parseTranscriptText parses plain text transcripts without timestamps', () => {
    const parsed = parseTranscriptText(SAMPLE_TRANSCRIPT_PLAIN);
    assert.equal(parsed.hasTimestamps, false);
    assert.ok(parsed.text.includes('Encapsulation is the bundling of data'));
});

test('12. parseTranscriptText parses SRT formatted transcripts', () => {
    const parsed = parseTranscriptText(SAMPLE_TRANSCRIPT_SRT);
    assert.equal(parsed.hasTimestamps, true);
    assert.ok(parsed.segments.length >= 5);
    assert.ok(parsed.text.includes('Polymorphism allows entities'));
});

test('13. parseTranscriptText handles empty and whitespace strings gracefully', () => {
    const parsed = parseTranscriptText('   ');
    assert.equal(parsed.text, '');
    assert.equal(parsed.segments.length, 0);
    assert.equal(parsed.hasTimestamps, false);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. Transcript Provider & Video Adapter Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('14. Video source adapter satisfies SourceAdapter contract', () => {
    assertAdapterContract(videoAdapter);
    assert.equal(videoAdapter.id, 'video');
    assert.equal(videoAdapter.canHandle({ type: 'video' }), true);
    assert.equal(videoAdapter.canHandle({ type: 'pdf' }), false);
    assert.equal(videoAdapter.canHandle({ type: 'text' }), false);
});

test('15. TranscriptProvider honestly reports browser CORS unavailability when no transcript provided', async () => {
    const provider = new TranscriptProvider();
    const videoResource = {
        id: 'res-vid-1',
        type: 'video',
        title: 'OOP Principles',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: null,
        metadata: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    };

    const result = await provider.acquireTranscript(videoResource);
    assert.equal(result.success, false);
    assert.equal(result.status, TRANSCRIPT_STATUS.UNAVAILABLE);
    assert.equal(result.code, 'TRANSCRIPT_UNAVAILABLE');
    assert.ok(result.reason.includes('CORS'));
});

test('16. TranscriptProvider successfully acquires transcript from options or resource content', async () => {
    const provider = new TranscriptProvider();
    const videoResource = {
        id: 'res-vid-2',
        type: 'video',
        title: 'OOP Principles',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: SAMPLE_TRANSCRIPT_RAW,
        metadata: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    };

    const result = await provider.acquireTranscript(videoResource);
    assert.equal(result.success, true);
    assert.equal(result.status, TRANSCRIPT_STATUS.AVAILABLE);
    assert.ok(result.text.includes('Encapsulation'));
    assert.ok(result.segments.length >= 6);
});

test('17. VideoAdapter extract and normalize pipeline processes transcript into normalized content model', async () => {
    const videoResource = {
        id: 'res-vid-3',
        type: 'video',
        title: 'OOP Principles',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: SAMPLE_TRANSCRIPT_RAW,
        metadata: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    };

    const extracted = await videoAdapter.extract(videoResource);
    assert.ok(extracted.text.length > 50);
    assert.equal(extracted.hasTimestamps, true);

    const normalized = videoAdapter.normalize(extracted, videoResource);
    assert.equal(normalized.resourceId, videoResource.id);
    assert.equal(normalized.sourceType, 'video');
    assert.equal(normalized.metadata.adapterId, 'video');
    assert.equal(normalized.metadata.videoId, 'dQw4w9WgXcQ');
    assert.ok(normalized.text.includes('Encapsulation is the bundling'));
});

test('18. VideoAdapter extract throws error when transcript is unavailable', async () => {
    const videoResource = {
        id: 'res-vid-empty',
        type: 'video',
        title: 'Empty Video',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: null,
        metadata: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    };

    await assert.rejects(
        () => videoAdapter.extract(videoResource),
        { code: 'TRANSCRIPT_UNAVAILABLE' }
    );
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. Unified Pipeline & Downstream Parity Tests
 * ═══════════════════════════════════════════════════════════════════════════ */

test('19. Unified content processing pipeline processes video resource into persisted chunks', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    const videoResource = createResourceRecord({
        id: 'video-res-oop',
        title: 'OOP Principles Lecture',
        type: 'video',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: SAMPLE_TRANSCRIPT_RAW,
        tags: ['cs', 'oop', 'programming'],
        metadata: {
            provider: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            transcriptStatus: 'available',
        },
    });

    await resRepo.createResource(videoResource);

    const processed = await processAndStore(videoResource, { resRepo, processedRepo });

    assert.ok(processed);
    assert.equal(processed.resourceId, videoResource.id);
    assert.ok(processed.chunks.length > 0);
    assert.ok(processed.normalizedText.includes('Encapsulation'));

    // Check repository persistence
    const stored = await processedRepo.getByResourceId(videoResource.id);
    assert.ok(stored);
    assert.equal(stored.chunks.length, processed.chunks.length);
});

test('20. Video processed content achieves downstream parity for Learning Outputs, Flashcards, and Quizzes', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    const videoResource = createResourceRecord({
        id: 'video-res-downstream',
        title: 'OOP Fundamentals',
        type: 'video',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: SAMPLE_TRANSCRIPT_RAW,
        tags: ['oop'],
        metadata: {
            provider: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            transcriptStatus: 'available',
        },
    });

    await resRepo.createResource(videoResource);
    const processed = await processAndStore(videoResource, { resRepo, processedRepo });

    // 1. Learning Outputs (Summary, Concepts, Definitions, Questions)
    const outputs = generateLearningOutputs(processed);
    assert.ok(outputs.length > 0);
    assert.ok(outputs.some((o) => o.type === 'summary'));
    assert.ok(outputs.some((o) => o.type === 'concept'));
    assert.ok(outputs.some((o) => o.type === 'definition'));
    assert.ok(outputs.some((o) => o.type === 'question'));

    // Verify source traceability: all outputs contain authentic sourceChunkIds
    outputs.forEach((output) => {
        assert.ok(Array.isArray(output.sourceChunkIds));
        assert.ok(output.sourceChunkIds.length > 0);
        output.sourceChunkIds.forEach((chunkId) => {
            assert.ok(processed.chunks.some((c) => c.id === chunkId || c.index === chunkId));
        });
    });

    // 2. Flashcards
    const flashcards = generateFlashcards(outputs, videoResource.id);
    assert.ok(flashcards.length > 0);
    flashcards.forEach((card) => {
        assert.ok(card.content.front.length > 0);
        assert.ok(card.content.back.length > 0);
        assert.ok(Array.isArray(card.sourceChunkIds));
    });

    // 3. Quizzes
    const quiz = generateQuiz(outputs, videoResource);
    assert.ok(quiz);
    assert.ok(quiz.questions.length >= 2);
    quiz.questions.forEach((q) => {
        assert.equal(q.options.length, 4);
        assert.ok(q.options.includes(q.correctAnswer));
        assert.ok(Array.isArray(q.sourceChunkIds));
    });
});

test('21. Reprocessing a video resource with updated transcript is idempotent', async () => {
    const resRepo = createMockResourceRepository();
    const processedRepo = createMockProcessedContentRepository();

    const videoResource = createResourceRecord({
        id: 'video-res-idempotent',
        title: 'OOP Principles',
        type: 'video',
        source: SAMPLE_YOUTUBE_URLS.standardWatch,
        content: SAMPLE_TRANSCRIPT_RAW,
        tags: [],
        metadata: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    });

    await resRepo.createResource(videoResource);

    // First process run
    const run1 = await processAndStore(videoResource, { resRepo, processedRepo });
    const count1 = run1.chunks.length;

    // Second process run (reprocess)
    const run2 = await processAndStore(videoResource, { resRepo, processedRepo });
    assert.equal(run2.chunks.length, count1);

    // Chunks did not duplicate in repository
    const stored = await processedRepo.getByResourceId(videoResource.id);
    assert.equal(stored.chunks.length, count1);
});
