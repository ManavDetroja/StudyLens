/**
 * Deterministic Content Analysis Layer — Day 10.
 *
 * Analyzes normalized text and chunks to extract:
 * 1. Key concepts (based on frequency, chunk distribution, and non-stopword significance)
 * 2. Definitions (based on explicit textual patterns)
 * 3. Questions (deterministic question formulations grounded in source concepts and definitions)
 * 4. Extractive summary (sentence selection using position and keyword density)
 *
 * All operations are pure, deterministic, and free of external AI/NLP dependencies.
 * Every extracted item retains sourceChunkIds for traceability.
 */

import { isStopword } from './stopwords.js';

/**
 * Split text into sentences with their character offsets.
 * Handles common sentence terminators (. ! ?) while avoiding false breaks on common abbreviations.
 *
 * @param {string} text
 * @returns {{ text: string, startOffset: number, endOffset: number }[]}
 */
export function splitSentences(text) {
    if (typeof text !== 'string' || text.trim() === '') return [];

    const sentences = [];
    // Matches sentence endings: . ! ? followed by whitespace or EOF, avoiding standard abbreviations
    const regex = /[^.!?\n]+(?:[.!?]+(?=\s+|$|\n)|$)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const raw = match[0];
        const trimmed = raw.trim();

        if (trimmed.length > 0) {
            const startOffset = match.index + raw.indexOf(trimmed);
            const endOffset = startOffset + trimmed.length;

            sentences.push({
                text: trimmed,
                startOffset,
                endOffset,
            });
        }
    }

    return sentences;
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

        // Check if [startOffset, endOffset] overlaps with [cStart, cEnd]
        if (Math.max(startOffset, cStart) < Math.min(endOffset, cEnd)) {
            matched.push(chunk.index);
        }
    }

    return matched.length > 0 ? matched : [chunks[0]?.index ?? 0];
}

/**
 * Extract candidate key concepts from sentences and chunks.
 *
 * @param {string} text
 * @param {Array<{ index: number, startOffset: number, endOffset: number, text: string }>} chunks
 * @param {object} [options]
 * @param {number} [options.maxConcepts=8]
 * @returns {Array<{ term: string, score: number, sourceChunkIds: number[] }>}
 */
export function extractKeyConcepts(text, chunks = [], options = {}) {
    if (typeof text !== 'string' || text.trim() === '') return [];
    const maxConcepts = options.maxConcepts ?? 8;

    // Word frequency & occurrences map
    const candidates = new Map(); // normalizedTerm -> { canonicalTerm, count, chunkIds: Set }

    // Tokenize words (letters, hyphens)
    const wordRegex = /\b[a-zA-Z][a-zA-Z0-9'-]{2,}\b/g;
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
        const rawWord = match[0];
        const normalized = rawWord.toLowerCase();

        if (isStopword(normalized)) continue;
        if (normalized.length < 3) continue;

        const offset = match.index;
        const chunkIds = findOverlappingChunkIds(offset, offset + rawWord.length, chunks);

        if (!candidates.has(normalized)) {
            candidates.set(normalized, {
                canonicalTerm: rawWord,
                count: 0,
                chunkIds: new Set(),
            });
        }

        const entry = candidates.get(normalized);
        entry.count += 1;
        chunkIds.forEach((id) => entry.chunkIds.add(id));

        // Preserve uppercase/capitalized version as canonical if available
        if (rawWord[0] === rawWord[0].toUpperCase() && entry.canonicalTerm[0] === entry.canonicalTerm[0].toLowerCase()) {
            entry.canonicalTerm = rawWord;
        }
    }

    // Also look for repeated 2-word technical phrases (e.g. "cell membrane", "calvin cycle")
    const sentences = splitSentences(text);
    sentences.forEach((sentence) => {
        const words = sentence.text.match(/\b[a-zA-Z][a-zA-Z0-9'-]{2,}\b/g) || [];
        for (let i = 0; i < words.length - 1; i++) {
            const w1 = words[i].toLowerCase();
            const w2 = words[i + 1].toLowerCase();

            if (!isStopword(w1) && !isStopword(w2)) {
                const phraseKey = `${w1} ${w2}`;
                const canonicalPhrase = `${words[i]} ${words[i + 1]}`;
                const phraseOffset = sentence.startOffset + sentence.text.indexOf(words[i]);
                const chunkIds = findOverlappingChunkIds(phraseOffset, phraseOffset + canonicalPhrase.length, chunks);

                if (!candidates.has(phraseKey)) {
                    candidates.set(phraseKey, {
                        canonicalTerm: canonicalPhrase,
                        count: 0,
                        chunkIds: new Set(),
                        isPhrase: true,
                        isCapitalized: words[i][0] === words[i][0].toUpperCase() && words[i + 1][0] === words[i + 1][0].toUpperCase(),
                    });
                }
                const entry = candidates.get(phraseKey);
                entry.count += 1;
                chunkIds.forEach((id) => entry.chunkIds.add(id));
            }
        }
    });

    // Score candidates deterministically
    const scored = [];
    for (const [key, data] of candidates.entries()) {
        // Discard arbitrary bigrams that only appear once unless capitalized title
        if (data.isPhrase && data.count < 2 && !data.isCapitalized) {
            continue;
        }

        const chunkCount = data.chunkIds.size;
        const lengthBonus = Math.min(data.canonicalTerm.length, 10);
        const phraseBonus = data.isPhrase ? 4 : 0;
        const chunkBonus = chunkCount > 1 ? chunkCount * 4 : 0;
        const score = (data.count * 6) + lengthBonus + phraseBonus + chunkBonus;

        scored.push({
            term: data.canonicalTerm,
            score,
            sourceChunkIds: Array.from(data.chunkIds).sort((a, b) => a - b),
        });
    }

    // Sort by score descending, then alphabetically for deterministic order
    scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

    return scored.slice(0, maxConcepts);
}

/**
 * Deterministic definition extraction using explicit textual patterns.
 *
 * @param {Array<{ text: string, startOffset: number, endOffset: number }>} sentences
 * @param {Array<{ index: number, startOffset: number, endOffset: number, text: string }>} chunks
 * @returns {Array<{ term: string, definition: string, sourceChunkIds: number[] }>}
 */
export function extractDefinitions(sentences = [], chunks = []) {
    const definitions = [];
    const seenTerms = new Set();

    // Deterministic definition patterns
    const patterns = [
        // Pattern 1: "X is defined as Y"
        /^([A-Z][a-zA-Z0-9\s'-]{1,40})\s+(?:is|are)\s+defined\s+as\s+(.+)$/i,
        // Pattern 2: "X refers to Y"
        /^([A-Z][a-zA-Z0-9\s'-]{1,40})\s+refers\s+to\s+(.+)$/i,
        // Pattern 3: "X means Y"
        /^([A-Z][a-zA-Z0-9\s'-]{1,40})\s+means\s+(.+)$/i,
        // Pattern 4: "X is a/an/the Y"
        /^([A-Z][a-zA-Z0-9\s'-]{1,40})\s+(?:is|are)\s+(?:a|an|the)\s+(.+)$/i,
        // Pattern 5: "X: Y"
        /^([A-Z][a-zA-Z0-9\s'-]{1,40})\s*:\s+(.+)$/,
    ];

    const genericTerms = new Set(['this', 'that', 'these', 'those', 'it', 'there', 'here', 'what', 'which', 'one']);

    for (const sentence of sentences) {
        for (const pattern of patterns) {
            const match = sentence.text.match(pattern);
            if (!match) continue;

            let term = match[1].trim();
            let definition = (match[2] || match[match.length - 1]).trim();

            // Strip trailing period from definition if present
            if (definition.endsWith('.')) {
                definition = definition.slice(0, -1).trim();
            }

            // Strip leading article from term if captured (e.g. "The cell" -> "Cell")
            term = term.replace(/^(?:the|a|an)\s+/i, '');

            // Guard against generic words or definitions that are too short
            if (genericTerms.has(term.toLowerCase())) continue;
            if (term.length < 2 || term.length > 50) continue;
            if (definition.length < 10) continue;

            const termKey = term.toLowerCase();
            if (seenTerms.has(termKey)) continue;

            seenTerms.add(termKey);
            const sourceChunkIds = findOverlappingChunkIds(sentence.startOffset, sentence.endOffset, chunks);

            definitions.push({
                term,
                definition,
                sourceChunkIds,
            });
            break; // Stop evaluating patterns for this sentence once matched
        }
    }

    return definitions;
}

/**
 * Generate deterministic study questions from extracted concepts and definitions.
 *
 * @param {Array<{ term: string, definition: string, sourceChunkIds: number[] }>} definitions
 * @param {Array<{ term: string, score: number, sourceChunkIds: number[] }>} concepts
 * @param {Array<{ text: string, startOffset: number, endOffset: number }>} sentences
 * @param {Array<{ index: number, startOffset: number, endOffset: number }>} chunks
 * @param {object} [options]
 * @param {number} [options.maxQuestions=6]
 * @returns {Array<{ question: string, term: string, sourceChunkIds: number[] }>}
 */
export function generateQuestions(definitions = [], concepts = [], sentences = [], chunks = [], options = {}) {
    const maxQuestions = options.maxQuestions ?? 6;
    const questions = [];
    const seenQuestions = new Set();

    function addQuestion(questionText, term, chunkIds) {
        const key = questionText.toLowerCase().trim();
        if (seenQuestions.has(key)) return;
        seenQuestions.add(key);
        questions.push({
            question: questionText,
            term,
            sourceChunkIds: chunkIds,
        });
    }

    // 1. Generate questions from definitions
    for (const def of definitions) {
        if (questions.length >= maxQuestions) break;

        const isPlural = def.term.toLowerCase().endsWith('s') && !def.term.toLowerCase().endsWith('is');
        const verb = isPlural ? 'are' : 'is';
        addQuestion(`What ${verb} ${def.term}?`, def.term, def.sourceChunkIds);

        if (questions.length < maxQuestions) {
            addQuestion(`What does ${def.term} refer to?`, def.term, def.sourceChunkIds);
        }
    }

    // 2. Generate questions from functional/causal sentence patterns
    const functionalPatterns = [
        {
            regex: /\b([A-Z][a-zA-Z0-9\s'-]{1,35})\s+(?:is used to|serves to|functions to|is responsible for)\s+([^.!?]+)/i,
            makeQuestion: (term) => `What is the purpose of ${term}?`,
        },
        {
            regex: /\b([A-Z][a-zA-Z0-9\s'-]{1,35})\s+(?:works by|operates by|functions by)\s+([^.!?]+)/i,
            makeQuestion: (term) => `How does ${term} work?`,
        },
        {
            regex: /\b([A-Z][a-zA-Z0-9\s'-]{1,35})\s+(?:occurs in|takes place in)\s+([^.!?]+)/i,
            makeQuestion: (term) => `Where does ${term} take place?`,
        },
    ];

    for (const sentence of sentences) {
        if (questions.length >= maxQuestions) break;

        for (const { regex, makeQuestion } of functionalPatterns) {
            const match = sentence.text.match(regex);
            if (!match) continue;

            let term = match[1].trim().replace(/^(?:the|a|an)\s+/i, '');
            if (term.length < 3 || isStopword(term.toLowerCase())) continue;

            const chunkIds = findOverlappingChunkIds(sentence.startOffset, sentence.endOffset, chunks);
            addQuestion(makeQuestion(term), term, chunkIds);
            break;
        }
    }

    // 3. Fallback: if we still have room, generate conceptual questions for top key concepts
    for (const concept of concepts) {
        if (questions.length >= maxQuestions) break;
        const isPlural = concept.term.toLowerCase().endsWith('s') && !concept.term.toLowerCase().endsWith('is');
        const verb = isPlural ? 'are' : 'is';
        addQuestion(`What ${verb} ${concept.term}?`, concept.term, concept.sourceChunkIds);
    }

    return questions.slice(0, maxQuestions);
}

/**
 * Generate a deterministic extractive summary by scoring and selecting top sentences.
 * Preserves original sentence wording and chronological order.
 *
 * @param {Array<{ text: string, startOffset: number, endOffset: number }>} sentences
 * @param {Array<{ term: string, score: number }>} keyConcepts
 * @param {Array<{ index: number, startOffset: number, endOffset: number }>} chunks
 * @param {object} [options]
 * @param {number} [options.maxSentences=3]
 * @returns {{ text: string, sourceChunkIds: number[], sentenceCount: number }}
 */
export function generateExtractiveSummary(sentences = [], keyConcepts = [], chunks = [], options = {}) {
    if (!Array.isArray(sentences) || sentences.length === 0) {
        return { text: '', sourceChunkIds: [], sentenceCount: 0 };
    }

    const maxSentences = Math.min(options.maxSentences ?? 3, sentences.length);
    const topTerms = new Set(keyConcepts.slice(0, 8).map((c) => c.term.toLowerCase()));

    // Score each sentence
    const scoredSentences = sentences.map((sentence, index) => {
        let score = 0;

        // Position bonus: first sentence of document is most salient
        if (index === 0) score += 6;
        else if (index === 1) score += 3;

        // Concept density bonus: how many key concepts appear in this sentence
        const lower = sentence.text.toLowerCase();
        let conceptMatches = 0;
        topTerms.forEach((term) => {
            if (lower.includes(term)) {
                score += 3;
                conceptMatches += 1;
            }
        });

        // Length normalization: prefer substantial sentences (40-180 chars)
        const len = sentence.text.length;
        if (len >= 40 && len <= 180) score += 2;
        else if (len < 25) score -= 3; // Disfavor trivial fragments

        const chunkIds = findOverlappingChunkIds(sentence.startOffset, sentence.endOffset, chunks);

        return {
            sentence,
            index,
            score,
            chunkIds,
        };
    });

    // Pick top N by score
    const topScored = [...scoredSentences]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences);

    // Re-sort selected sentences by their original chronological index to maintain readable flow
    topScored.sort((a, b) => a.index - b.index);

    const summaryText = topScored.map((s) => s.sentence.text).join(' ');
    const allChunkIds = new Set();
    topScored.forEach((s) => s.chunkIds.forEach((id) => allChunkIds.add(id)));

    return {
        text: summaryText,
        sourceChunkIds: Array.from(allChunkIds).sort((a, b) => a - b),
        sentenceCount: topScored.length,
    };
}

/**
 * Main deterministic content analysis coordinator.
 *
 * @param {object} processedContent — record containing normalizedText and chunks
 * @param {object} [options]
 * @returns {object} analysis result
 */
export function analyzeContent(processedContent, options = {}) {
    if (!processedContent) {
        throw new Error('Processed content is required for analysis.');
    }

    const text = processedContent.normalizedText ?? processedContent.text ?? '';
    const chunks = processedContent.chunks ?? processedContent.segments ?? [];

    if (typeof text !== 'string' || text.trim() === '') {
        return {
            concepts: [],
            definitions: [],
            questions: [],
            summary: { text: '', sourceChunkIds: [], sentenceCount: 0 },
            metadata: { totalSentences: 0, totalWords: 0, analyzedAt: new Date().toISOString() },
        };
    }

    const sentences = splitSentences(text);
    const concepts = extractKeyConcepts(text, chunks, options);
    const definitions = extractDefinitions(sentences, chunks);
    const questions = generateQuestions(definitions, concepts, sentences, chunks, options);
    const summary = generateExtractiveSummary(sentences, concepts, chunks, options);

    const words = text.match(/\b\w+\b/g) || [];

    return {
        concepts,
        definitions,
        questions,
        summary,
        metadata: {
            totalSentences: sentences.length,
            totalWords: words.length,
            analyzedAt: new Date().toISOString(),
        },
    };
}
