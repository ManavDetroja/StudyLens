/**
 * Transcript Parsing & Timestamp Handling — Day 21.
 *
 * Deterministically parses transcript text (with or without timestamps, SRT/VTT,
 * or YouTube "Show transcript" copy-paste format).
 * Preserves timing metadata for source traceability and downstream chunking.
 */

const TIMESTAMP_LINE_REGEX = /^(?:\[|\()?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?(?:\]|\))?(?:\s*(?:-->|–|-)\s*(?:\[|\()?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?(?:\]|\))?)?/;
const TIMESTAMP_INLINE_REGEX = /(?:\[|\()?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?(?:\]|\))?\s*/;

/**
 * Convert timestamp string (HH:MM:SS or MM:SS) to total seconds.
 *
 * @param {string} timestampStr
 * @returns {number|null}
 */
export function parseTimestampToSeconds(timestampStr) {
    if (!timestampStr || typeof timestampStr !== 'string') return null;
    const cleaned = timestampStr.replace(/[\[\]\(\)]/g, '').trim();
    const parts = cleaned.split(':').map((p) => Number.parseFloat(p));
    if (parts.some((n) => Number.isNaN(n))) return null;

    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return null;
}

/**
 * Format numeric seconds to MM:SS or HH:MM:SS.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatSecondsToTimestamp(seconds) {
    if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) {
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Parse transcript text into structured segments and clean text.
 *
 * @param {string} rawText
 * @returns {{
 *   rawText: string,
 *   text: string,
 *   hasTimestamps: boolean,
 *   segments: Array<{
 *     index: number,
 *     text: string,
 *     timestamp: string,
 *     startSeconds: number,
 *     endSeconds?: number,
 *     endTimestamp?: string
 *   }>,
 *   metadata: Record<string, unknown>
 * }}
 */
export function parseTranscriptText(rawText) {
    if (typeof rawText !== 'string' || rawText.trim() === '') {
        return {
            rawText: '',
            text: '',
            hasTimestamps: false,
            segments: [],
            metadata: { segmentCount: 0 },
        };
    }

    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const segments = [];
    const textPieces = [];

    let currentTimestamp = null;
    let currentSeconds = null;
    let currentBuffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if line is a standalone timestamp or begins with timestamp
        const match = line.match(TIMESTAMP_LINE_REGEX);

        if (match && match.index === 0) {
            const matchedTimestamp = match[0].trim();
            const startSecs = parseTimestampToSeconds(matchedTimestamp);

            // If we had buffered text from previous segment, flush it
            if (currentBuffer.length > 0) {
                const segText = currentBuffer.join(' ').trim();
                if (segText) {
                    segments.push({
                        index: segments.length,
                        text: segText,
                        timestamp: currentTimestamp || '00:00',
                        startSeconds: currentSeconds ?? 0,
                    });
                    textPieces.push(segText);
                }
                currentBuffer = [];
            }

            currentTimestamp = formatSecondsToTimestamp(startSecs ?? 0);
            currentSeconds = startSecs ?? 0;

            // Rest of line after timestamp
            const restOfLine = line.slice(match[0].length).trim();
            if (restOfLine) {
                currentBuffer.push(restOfLine);
            }
        } else {
            // Regular text line
            currentBuffer.push(line);
        }
    }

    // Flush remaining buffer
    if (currentBuffer.length > 0) {
        const segText = currentBuffer.join(' ').trim();
        if (segText) {
            segments.push({
                index: segments.length,
                text: segText,
                timestamp: currentTimestamp || '00:00',
                startSeconds: currentSeconds ?? 0,
            });
            textPieces.push(segText);
        }
    }

    // Assign endSeconds if multiple segments exist
    for (let j = 0; j < segments.length - 1; j++) {
        segments[j].endSeconds = segments[j + 1].startSeconds;
        segments[j].endTimestamp = segments[j + 1].timestamp;
    }

    const hasTimestamps = segments.length > 0 && segments.some((s) => s.startSeconds > 0 || segments.length > 1);
    const cleanText = textPieces.length > 0 ? textPieces.join('\n\n') : rawText.trim();

    return {
        rawText,
        text: cleanText,
        hasTimestamps,
        segments,
        metadata: {
            segmentCount: segments.length,
            hasTimestamps,
            totalDurationSeconds: segments.length > 0 ? segments[segments.length - 1].startSeconds : 0,
            formattedDuration: segments.length > 0
                ? formatSecondsToTimestamp(segments[segments.length - 1].startSeconds)
                : '00:00',
        },
    };
}
