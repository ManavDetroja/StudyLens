/**
 * Transcript Acquisition Architecture — Day 21.
 *
 * Implements the transcript provider contract for video resources.
 * Handles client-side browser capabilities honestly:
 * - Detects provided transcript from options, resource content, or metadata.
 * - Supports pluggable transcript fetchers (e.g. testing or future extensions).
 * - Distinguishes between successful transcript acquisition and explicit
 *   browser/CORS unavailability without scraping or fake content.
 */

import { parseTranscriptText } from './transcriptParser.js';

export const TRANSCRIPT_STATUS = Object.freeze({
    PENDING: 'pending',
    AVAILABLE: 'available',
    UNAVAILABLE: 'unavailable',
    MANUAL: 'manual',
});

/**
 * Standard transcript provider contract.
 */
export class TranscriptProvider {
    canHandle(resource) {
        return Boolean(resource && resource.type === 'video');
    }

    /**
     * Acquire transcript for a video resource.
     *
     * @param {object} resource - The Video Resource
     * @param {object} [options]
     * @param {string} [options.transcript] - Explicitly passed transcript text
     * @param {Function} [options.transcriptFetcher] - Optional pluggable fetcher
     * @returns {Promise<{
     *   success: boolean,
     *   status: string,
     *   text?: string,
     *   rawText?: string,
     *   hasTimestamps?: boolean,
     *   segments?: Array<object>,
     *   metadata?: Record<string, unknown>,
     *   code?: string,
     *   reason?: string
     * }>}
     */
    async acquireTranscript(resource, options = {}) {
        if (!this.canHandle(resource)) {
            return {
                success: false,
                status: TRANSCRIPT_STATUS.UNAVAILABLE,
                code: 'UNSUPPORTED_RESOURCE_TYPE',
                reason: 'Transcript provider only supports video resources.',
            };
        }

        // 1. Check for directly provided transcript text in options
        let rawText = null;
        let sourceMethod = null;

        if (typeof options.transcript === 'string' && options.transcript.trim() !== '') {
            rawText = options.transcript;
            sourceMethod = 'options';
        } else if (typeof options.text === 'string' && options.text.trim() !== '') {
            rawText = options.text;
            sourceMethod = 'options';
        } else if (typeof resource.content === 'string' && resource.content.trim() !== '') {
            rawText = resource.content;
            sourceMethod = 'resource-content';
        } else if (typeof resource.metadata?.transcript === 'string' && resource.metadata.transcript.trim() !== '') {
            rawText = resource.metadata.transcript;
            sourceMethod = 'resource-metadata';
        } else if (typeof resource.metadata?.pastedTranscript === 'string' && resource.metadata.pastedTranscript.trim() !== '') {
            rawText = resource.metadata.pastedTranscript;
            sourceMethod = 'manual-paste';
        }

        // 2. Check for pluggable fetcher (e.g. in test or custom provider)
        if (!rawText && typeof options.transcriptFetcher === 'function') {
            try {
                const fetched = await options.transcriptFetcher(resource, options);
                if (typeof fetched === 'string' && fetched.trim() !== '') {
                    rawText = fetched;
                    sourceMethod = 'custom-fetcher';
                } else if (fetched && typeof fetched.text === 'string' && fetched.text.trim() !== '') {
                    rawText = fetched.text;
                    sourceMethod = 'custom-fetcher';
                }
            } catch (fetchErr) {
                return {
                    success: false,
                    status: TRANSCRIPT_STATUS.UNAVAILABLE,
                    code: 'TRANSCRIPT_FETCH_FAILED',
                    reason: 'Custom transcript fetcher failed: ' + (fetchErr.message || 'Unknown error'),
                };
            }
        }

        // 3. If raw transcript text is found, parse and return success
        if (rawText && rawText.trim() !== '') {
            const parsed = parseTranscriptText(rawText);
            return {
                success: true,
                status: TRANSCRIPT_STATUS.AVAILABLE,
                text: parsed.text,
                rawText: parsed.rawText,
                hasTimestamps: parsed.hasTimestamps,
                segments: parsed.segments,
                metadata: {
                    provider: resource.metadata?.provider || 'youtube',
                    videoId: resource.metadata?.videoId,
                    sourceMethod,
                    ...parsed.metadata,
                },
            };
        }

        // 4. Honest browser capability reporting:
        // Pure client-side browser cannot bypass YouTube CORS to scrape internal caption endpoints.
        return {
            success: false,
            status: TRANSCRIPT_STATUS.UNAVAILABLE,
            code: 'TRANSCRIPT_UNAVAILABLE',
            reason: 'Direct YouTube transcript retrieval is restricted by browser security policies (CORS). Please paste the video transcript or captions to proceed with study aids.',
        };
    }
}

export const defaultTranscriptProvider = new TranscriptProvider();
