/**
 * Deterministic Source Evidence Retrieval & Relevance Layer — Day 19.
 *
 * Implements pure, client-side, deterministic source grounding for learning outputs:
 * 1. Forbidden placeholder detection (rejects generic boilerplate answers)
 * 2. Learning answer validation (ensures answers have substance and source grounding)
 * 3. Relevant sentence retrieval (token overlap, explanatory verb detection, length scoring)
 * 4. Grounded evidence extraction for concepts and questions
 * 5. Strict source chunk traceability preservation
 *
 * Zero external AI/LLMs, embeddings, or vector databases.
 */

import { isStopword } from './stopwords.js';

/**
 * List of regex patterns identifying hollow, generic placeholder responses.
 * Used to reject answers that do not convey meaningful learning information.
 */
export const FORBIDDEN_PLACEHOLDER_PATTERNS = Object.freeze([
    /^key concept identified.*$/i,
    /^review concept:\s*.+$/i,
    /^review the source material.*$/i,
    /^answer unavailable.*$/i,
    /^concept identified.*$/i,
    /^definition identified.*$/i,
    /^generated from this resource.*$/i,
    /^this is an important concept.*$/i,
    /^the resource discusses\b.*$/i,
    /^this resource explains\b.*$/i,
    /^information about .+ is provided.*$/i,
    /^identified in this resource.*$/i,
    /^generated (?:by|from) this resource.*$/i,
]);

/**
 * Check if a text is a generic placeholder or lacks substantive learning information.
 *
 * @param {unknown} text
 * @returns {boolean} true if generic/placeholder, false if substantive
 */
export function isGenericPlaceholder(text) {
    if (typeof text !== 'string') return true;
    const trimmed = text.trim();
    if (trimmed.length === 0) return true;

    for (const pattern of FORBIDDEN_PLACEHOLDER_PATTERNS) {
        if (pattern.test(trimmed)) return true;
    }

    const lower = trimmed.toLowerCase();
    if (
        lower.includes('key concept identified in this resource') ||
        lower.includes('review the source material for this question') ||
        lower.includes('answer unavailable')
    ) {
        return true;
    }

    return false;
}

/**
 * Validates that an answer or explanation meets quality standards:
 * - non-empty string
 * - at least minChars characters (default 8)
 * - not a forbidden generic placeholder
 * - contains authentic words (not purely punctuation or numbers)
 *
 * @param {unknown} text
 * @param {object} [options]
 * @param {number} [options.minChars=8]
 * @returns {boolean}
 */
export function validateLearningAnswer(text, options = {}) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    const minChars = options.minChars ?? 8;

    if (trimmed.length < minChars) return false;
    if (isGenericPlaceholder(trimmed)) return false;

    // Must contain authentic letters, not just punctuation or digits
    if (!/[a-zA-Z]{2,}/.test(trimmed)) return false;

    return true;
}

/**
 * Find chunk indices that overlap with a given text span.
 *
 * @param {number} startOffset
 * @param {number} endOffset
 * @param {Array<{ index: number, startOffset: number, endOffset: number }>} chunks
 * @returns {number[]} sorted unique chunk indices
 */
export function findOverlappingChunkIds(startOffset, endOffset, chunks = []) {
    if (!Array.isArray(chunks) || chunks.length === 0) return [0];

    const matched = [];
    for (const chunk of chunks) {
        const cStart = chunk.startOffset ?? 0;
        const cEnd = chunk.endOffset ?? Infinity;

        if (Math.max(startOffset, cStart) < Math.min(endOffset, cEnd)) {
            matched.push(chunk.index);
        }
    }

    return matched.length > 0 ? matched : [chunks[0]?.index ?? 0];
}

/**
 * Check if a candidate sentence genuinely explains or defines the term,
 * rather than mentioning it in passing as an object of a preposition.
 *
 * @param {string} sentenceText
 * @param {string} term
 * @returns {boolean}
 */
export function isExplanatorySentence(sentenceText, term) {
    if (!term || typeof term !== 'string' || typeof sentenceText !== 'string') return false;
    const termClean = term.trim();
    if (!termClean) return false;
    const termEscaped = termClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Term followed directly by an explanatory or functional verb
    const explanatoryVerbRegex = new RegExp(
        `\\b${termEscaped}\\s+(?:is|are|refers\\s+to|means|defined\\s+as|allows|enables|provides|occurs\\s+when|consists\\s+of|functions\\s+to|is\\s+used\\s+to|serves\\s+to|represents|works\\s+by|absorbs|contains|controls|regulates|generates|produces|converts)\\b`,
        'i'
    );
    if (explanatoryVerbRegex.test(sentenceText)) return true;

    // 2. Term starts the sentence (subject position, within first 30 chars)
    const startsWithTerm = new RegExp(`^(?:the|a|an)?\\s*${termEscaped}\\b`, 'i');
    if (startsWithTerm.test(sentenceText)) return true;

    // 3. Explicit colon structure "Term: explanation"
    const colonPattern = new RegExp(`^${termEscaped}\\s*:`, 'i');
    if (colonPattern.test(sentenceText)) return true;

    return false;
}

/**
 * Clean and format an extracted explanation or answer:
 * - Strips leading transition adverbs (e.g. "However, ", "Therefore, ")
 * - Normalizes leading definition phrases ("Term is defined as X" -> "X")
 * - Capitalizes the first character
 * - Ensures appropriate sentence termination
 *
 * @param {string} rawText
 * @param {string} [term]
 * @returns {string}
 */
export function cleanExplanationText(rawText, term = '') {
    if (typeof rawText !== 'string') return '';
    let text = rawText.trim();

    // Strip leading transitional discourse markers
    text = text.replace(/^(?:however|therefore|moreover|furthermore|in addition|additionally|specifically|for example|as a result),?\s+/i, '');

    if (term && typeof term === 'string') {
        const termEscaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Pattern: "Term is defined as X" -> "X"
        const definedAsMatch = text.match(new RegExp(`^${termEscaped}\\s+(?:is|are)\\s+defined\\s+as\\s+(.+)$`, 'i'));
        if (definedAsMatch) {
            text = definedAsMatch[1].trim();
        } else {
            // Pattern: "Term refers to X" -> "X"
            const refersMatch = text.match(new RegExp(`^${termEscaped}\\s+refers\\s+to\\s+(.+)$`, 'i'));
            if (refersMatch) {
                text = refersMatch[1].trim();
            } else {
                // Pattern: "Term means X" -> "X"
                const meansMatch = text.match(new RegExp(`^${termEscaped}\\s+means\\s+(.+)$`, 'i'));
                if (meansMatch) {
                    text = meansMatch[1].trim();
                } else {
                    // Pattern: "Term is/are a/an/the X" -> "The X" or "A X"
                    const isArticleMatch = text.match(new RegExp(`^${termEscaped}\\s+(?:is|are)\\s+(a|an|the)\\s+(.+)$`, 'i'));
                    if (isArticleMatch) {
                        const article = isArticleMatch[1].charAt(0).toUpperCase() + isArticleMatch[1].slice(1).toLowerCase();
                        text = `${article} ${isArticleMatch[2].trim()}`;
                    } else {
                        // Pattern: "Term allows/enables/provides/occurs when/..." -> "Allows/..."
                        const verbMatch = text.match(new RegExp(`^${termEscaped}\\s+((?:allows|enables|provides|occurs|happens|consists|represents|functions|serves)\\b.+)$`, 'i'));
                        if (verbMatch) {
                            text = verbMatch[1].trim();
                        }
                    }
                }
            }
        }
    }

    // Capitalize first character
    if (text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    // Ensure terminal period
    if (/[a-zA-Z0-9)]$/.test(text)) {
        text += '.';
    }

    return text;
}

/**
 * Deterministically find and rank relevant source sentences for a term or query.
 *
 * Scoring signals:
 * - Exact term/phrase match: +15
 * - Explanatory verb directly following term: +25
 * - Term at beginning of sentence: +10
 * - Non-stopword token overlap: +4 per matching token
 * - Concise study length (35-220 chars): +4
 * - Fragment penalty (< 25 chars): -8
 * - Overly long penalty (> 300 chars): -4
 * - Position tie-breaker (earlier sentences): +0 to +5
 * - Generic boilerplate penalty: -100
 *
 * @param {string} queryOrTerm
 * @param {Array<{ text: string, startOffset: number, endOffset: number }>} sentences
 * @param {Array<{ index: number, startOffset: number, endOffset: number }>} chunks
 * @param {object} [options]
 * @param {number} [options.minScore=10]
 * @returns {Array<{ sentence: object, text: string, score: number, chunkIds: number[], index: number }>}
 */
export function findRelevantSentences(queryOrTerm, sentences = [], chunks = [], options = {}) {
    if (
        typeof queryOrTerm !== 'string' ||
        queryOrTerm.trim() === '' ||
        !Array.isArray(sentences) ||
        sentences.length === 0
    ) {
        return [];
    }

    const minScore = options.minScore ?? 10;
    const termClean = queryOrTerm.trim();
    const termLower = termClean.toLowerCase();
    const termWords = termLower.split(/\s+/).filter((w) => w.length >= 2 && !isStopword(w));

    const termEscaped = termClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactPhraseRegex = new RegExp(`\\b${termEscaped}\\b`, 'i');
    const explanatoryVerbRegex = new RegExp(
        `\\b${termEscaped}\\s+(?:is|are|refers\\s+to|means|defined\\s+as|allows|enables|provides|occurs\\s+when|consists\\s+of|functions\\s+to|is\\s+used\\s+to|serves\\s+to|represents)\\b`,
        'i'
    );

    const scored = [];

    for (let idx = 0; idx < sentences.length; idx++) {
        const s = sentences[idx];
        const sText = s.text.trim();
        if (sText.length < 15 || isGenericPlaceholder(sText)) continue;

        let score = 0;

        // 1. Explanatory pattern matching term + verb
        if (explanatoryVerbRegex.test(sText)) {
            score += 25;
        } else if (exactPhraseRegex.test(sText)) {
            score += 15;
        }

        // 2. Term starts sentence
        if (new RegExp(`^${termEscaped}\\b`, 'i').test(sText)) {
            score += 10;
        }

        // 3. Token overlap for non-stopwords
        const sLower = sText.toLowerCase();
        let overlapCount = 0;
        for (const w of termWords) {
            const wRegex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (wRegex.test(sLower)) {
                overlapCount++;
            }
        }
        score += overlapCount * 4;

        if (score === 0) continue;

        // 4. Length suitability
        if (sText.length >= 35 && sText.length <= 220) {
            score += 4;
        } else if (sText.length < 25) {
            score -= 8;
        } else if (sText.length > 300) {
            score -= 4;
        }

        // 5. Earlier appearance tie-breaker
        score += Math.max(0, 5 - idx * 0.2);

        if (score >= minScore) {
            const chunkIds = findOverlappingChunkIds(s.startOffset, s.endOffset, chunks);
            scored.push({
                sentence: s,
                text: sText,
                score,
                chunkIds,
                index: idx,
            });
        }
    }

    // Sort by score descending, then by original document order
    scored.sort((a, b) => b.score - a.score || a.index - b.index);

    return scored;
}

/**
 * Extract the best grounded supporting evidence/explanation for a key concept.
 * Rejects passing mentions that do not explain the concept.
 *
 * @param {string} term
 * @param {Array<{ text: string, startOffset: number, endOffset: number }>} sentences
 * @param {Array<{ index: number, startOffset: number, endOffset: number }>} chunks
 * @param {object} [options]
 * @returns {{ explanation: string, sentence: object, score: number, sourceChunkIds: number[] } | null}
 */
export function extractEvidenceForTerm(term, sentences = [], chunks = [], options = {}) {
    if (!term || typeof term !== 'string' || term.trim() === '') return null;

    const candidates = findRelevantSentences(term, sentences, chunks, options);
    if (candidates.length === 0) return null;

    // Filter candidates to ensure they genuinely explain the term
    for (const cand of candidates) {
        if (!isExplanatorySentence(cand.text, term)) {
            continue;
        }

        const cleaned = cleanExplanationText(cand.text, term);
        if (validateLearningAnswer(cleaned)) {
            return {
                explanation: cleaned,
                sentence: cand.sentence,
                score: cand.score,
                sourceChunkIds: cand.chunkIds,
            };
        }
    }

    return null;
}

/**
 * Extract a deterministic, source-grounded answer for a study question.
 *
 * @param {string} question
 * @param {string} [term]
 * @param {Array<{ text: string, startOffset: number, endOffset: number }>} sentences
 * @param {Array<{ index: number, startOffset: number, endOffset: number }>} chunks
 * @param {object} [options]
 * @returns {{ answer: string, sourceChunkIds: number[], score: number } | null}
 */
export function extractAnswerForQuestion(question, term = '', sentences = [], chunks = [], options = {}) {
    if (!question || typeof question !== 'string' || question.trim() === '') return null;

    // Determine target search term
    let targetTerm = (typeof term === 'string' && term.trim()) || '';
    if (!targetTerm) {
        // Derive term from question (e.g. "What is method overloading?" -> "method overloading")
        const whatIsMatch = question.match(/(?:what\s+(?:is|are)|how\s+does|where\s+does|purpose\s+of)\s+([^?]+)\??/i);
        if (whatIsMatch) {
            targetTerm = whatIsMatch[1].trim().replace(/^(?:the|a|an)\s+/i, '');
        }
    }

    if (!targetTerm) return null;

    // First try extracting explanatory evidence for the target term
    const evidence = extractEvidenceForTerm(targetTerm, sentences, chunks, options);
    if (evidence) {
        return {
            answer: evidence.explanation,
            sourceChunkIds: evidence.sourceChunkIds,
            score: evidence.score,
        };
    }

    // If no direct explanatory sentence, search relevant sentences for query
    const candidates = findRelevantSentences(targetTerm, sentences, chunks, options);
    for (const cand of candidates) {
        const cleaned = cleanExplanationText(cand.text, targetTerm);
        if (validateLearningAnswer(cleaned)) {
            return {
                answer: cleaned,
                sourceChunkIds: cand.chunkIds,
                score: cand.score,
            };
        }
    }

    return null;
}
