/**
 * YouTube URL Validation & Parsing — Day 21.
 *
 * Deterministic, security-safe URL parsing using the native URL API.
 * Extracts canonical 11-character YouTube video identifiers while rejecting
 * malformed, unsupported, or untrusted URL inputs without executing strings.
 */

import { ResourceValidationError } from '../storage/errors.js';

export const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const SUPPORTED_YOUTUBE_HOSTS = Object.freeze([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
]);

/**
 * Validate and parse a candidate YouTube URL string.
 *
 * @param {string} input - The URL to validate
 * @returns {{ isValid: boolean, videoId?: string, canonicalUrl?: string, originalUrl?: string, reason?: string, code?: string }}
 */
export function parseYouTubeUrl(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        return {
            isValid: false,
            reason: 'Please enter a YouTube video URL.',
            code: 'YOUTUBE_URL_EMPTY',
        };
    }

    const trimmed = input.trim();
    let url;
    try {
        url = new URL(trimmed);
    } catch {
        return {
            isValid: false,
            reason: 'The entered text is not a valid URL.',
            code: 'INVALID_URL_FORMAT',
        };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return {
            isValid: false,
            reason: 'Only HTTP and HTTPS URLs are supported.',
            code: 'INVALID_URL_PROTOCOL',
        };
    }

    const hostname = url.hostname.toLowerCase();
    const isSupportedHost = SUPPORTED_YOUTUBE_HOSTS.some(
        (host) => hostname === host || hostname.endsWith('.' + host)
    );

    if (!isSupportedHost) {
        return {
            isValid: false,
            reason: 'The provided URL is not from YouTube.',
            code: 'UNSUPPORTED_VIDEO_HOST',
        };
    }

    let candidateId = null;

    if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
        // Short URL: https://youtu.be/VIDEO_ID
        const pathSegments = url.pathname.split('/').filter(Boolean);
        if (pathSegments.length > 0) {
            candidateId = pathSegments[0];
        }
    } else {
        // Full YouTube URL
        if (url.pathname === '/watch') {
            candidateId = url.searchParams.get('v');
        } else if (url.pathname.startsWith('/embed/')) {
            candidateId = url.pathname.slice('/embed/'.length).split('/')[0];
        } else if (url.pathname.startsWith('/shorts/')) {
            candidateId = url.pathname.slice('/shorts/'.length).split('/')[0];
        } else if (url.pathname.startsWith('/v/')) {
            candidateId = url.pathname.slice('/v/'.length).split('/')[0];
        }
    }

    if (!candidateId || !YOUTUBE_VIDEO_ID_REGEX.test(candidateId)) {
        return {
            isValid: false,
            reason: 'Could not extract a valid 11-character YouTube video ID from this URL.',
            code: 'INVALID_YOUTUBE_VIDEO_ID',
        };
    }

    const canonicalUrl = buildCanonicalYouTubeUrl(candidateId);

    return {
        isValid: true,
        videoId: candidateId,
        canonicalUrl,
        originalUrl: trimmed,
    };
}

/**
 * Check whether a URL is a valid supported YouTube video URL.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function isValidYouTubeUrl(input) {
    return parseYouTubeUrl(input).isValid;
}

/**
 * Extract the 11-character video ID from a YouTube URL.
 *
 * @param {string} input
 * @returns {string|null}
 */
export function extractYouTubeVideoId(input) {
    const result = parseYouTubeUrl(input);
    return result.isValid ? result.videoId : null;
}

/**
 * Build the canonical watch URL for a video ID.
 *
 * @param {string} videoId
 * @returns {string}
 */
export function buildCanonicalYouTubeUrl(videoId) {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
        throw new ResourceValidationError('Invalid YouTube video ID.', {
            code: 'INVALID_YOUTUBE_VIDEO_ID',
        });
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Build a safe YouTube nocookie embed URL for a video ID.
 *
 * @param {string} videoId
 * @returns {string}
 */
export function buildYouTubeEmbedUrl(videoId) {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
        throw new ResourceValidationError('Invalid YouTube video ID.', {
            code: 'INVALID_YOUTUBE_VIDEO_ID',
        });
    }
    return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

/**
 * Build a standard public YouTube thumbnail image URL.
 *
 * @param {string} videoId
 * @param {'default'|'mqdefault'|'hqdefault'} [quality='hqdefault']
 * @returns {string}
 */
export function buildYouTubeThumbnailUrl(videoId, quality = 'hqdefault') {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
        return '';
    }
    return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}
