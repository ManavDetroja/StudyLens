import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isGenericPlaceholder,
    validateLearningAnswer,
    findRelevantSentences,
    extractEvidenceForTerm,
    extractAnswerForQuestion,
    cleanExplanationText,
    isExplanatorySentence,
    findOverlappingChunkIds,
    FORBIDDEN_PLACEHOLDER_PATTERNS,
} from '../js/processing/evidenceRetrieval.js';

import {
    splitSentences,
    extractKeyConcepts,
    extractDefinitions,
    generateQuestions,
    generateExtractiveSummary,
    analyzeContent,
} from '../js/processing/contentAnalysis.js';

import { generateLearningOutputs } from '../js/processing/learningOutputGenerator.js';
import { generateFlashcards } from '../js/processing/flashcardGenerator.js';
import { generateQuiz } from '../js/processing/quizGenerator.js';

/* ── Phase 16 Test Fixture: Java OOP Sample ──────────────────────── */

const JAVA_OOP_TEXT = `Encapsulation is the process of bundling data and methods together and controlling access to the data.

Inheritance allows one class to acquire properties and methods from another class.

Polymorphism allows the same interface to behave in different ways.

Method overloading occurs when multiple methods in the same class have the same name but different parameter lists.`;

function createJavaOOPProcessedContent() {
    const chunk1 = `Encapsulation is the process of bundling data and methods together and controlling access to the data.\n\nInheritance allows one class to acquire properties and methods from another class.\n\n`;
    const chunk2 = `Polymorphism allows the same interface to behave in different ways.\n\nMethod overloading occurs when multiple methods in the same class have the same name but different parameter lists.`;

    const fullText = chunk1 + chunk2;

    return {
        id: 'proc-java-oop-1',
        resourceId: 'res-java-oop',
        normalizedText: fullText,
        chunks: [
            {
                index: 0,
                startOffset: 0,
                endOffset: chunk1.length,
                text: chunk1,
            },
            {
                index: 1,
                startOffset: chunk1.length,
                endOffset: fullText.length,
                text: chunk2,
            },
        ],
        sourceType: 'text',
        metadata: {},
        createdAt: '2026-09-27T10:00:00.000Z',
        updatedAt: '2026-09-27T10:00:00.000Z',
    };
}

/* ── 1. Generic Placeholder Detection ────────────────────────────── */

test('1. isGenericPlaceholder detects all forbidden placeholder strings and patterns', () => {
    // Exact forbidden placeholders
    assert.equal(isGenericPlaceholder('Key concept identified in this resource'), true);
    assert.equal(isGenericPlaceholder('Key concept identified in this resource.'), true);
    assert.equal(isGenericPlaceholder('Review concept: Inheritance'), true);
    assert.equal(isGenericPlaceholder('Review the source material for this question.'), true);
    assert.equal(isGenericPlaceholder('Answer unavailable'), true);
    assert.equal(isGenericPlaceholder('Concept identified'), true);
    assert.equal(isGenericPlaceholder('Definition identified'), true);
    assert.equal(isGenericPlaceholder('Generated from this resource'), true);
    assert.equal(isGenericPlaceholder('This is an important concept.'), true);
    assert.equal(isGenericPlaceholder('The resource discusses this topic'), true);
    assert.equal(isGenericPlaceholder('This resource explains the concept'), true);
    assert.equal(isGenericPlaceholder('Information about Java is provided'), true);

    // Empty and whitespace values
    assert.equal(isGenericPlaceholder(''), true);
    assert.equal(isGenericPlaceholder('   '), true);
    assert.equal(isGenericPlaceholder(null), true);
    assert.equal(isGenericPlaceholder(undefined), true);

    // Substantive, authentic learning content must NOT be flagged as generic
    assert.equal(isGenericPlaceholder('Allows one class to acquire properties and methods from another class.'), false);
    assert.equal(isGenericPlaceholder('The process of bundling data and methods together.'), false);
    assert.equal(isGenericPlaceholder('The specialized cellular organelles where photosynthesis takes place.'), false);
});

/* ── 2. Concept Explanation Extraction ───────────────────────────── */

test('2. extractEvidenceForTerm extracts grounded explanation for key concepts', () => {
    const pc = createJavaOOPProcessedContent();
    const sentences = splitSentences(pc.normalizedText);

    const evidence = extractEvidenceForTerm('Inheritance', sentences, pc.chunks);
    assert.ok(evidence);
    assert.ok(evidence.explanation.includes('acquire properties and methods'));
    assert.notEqual(evidence.explanation, 'Key concept identified in this resource.');
    assert.deepEqual(evidence.sourceChunkIds, [0]);
});

/* ── 3. Definition Extraction with Expanded Patterns ──────────────── */

test('3. extractDefinitions extracts definitions using patterns 1-9 including allows and occurs when', () => {
    const pc = createJavaOOPProcessedContent();
    const sentences = splitSentences(pc.normalizedText);
    const defs = extractDefinitions(sentences, pc.chunks);

    assert.ok(defs.length >= 3);

    const terms = defs.map((d) => d.term);
    assert.ok(terms.includes('Encapsulation'));
    assert.ok(terms.includes('Inheritance'));
    assert.ok(terms.includes('Polymorphism'));
    assert.ok(terms.includes('Method overloading'));

    const inhDef = defs.find((d) => d.term === 'Inheritance');
    assert.ok(inhDef);
    assert.ok(inhDef.definition.includes('acquire properties and methods'));
    assert.deepEqual(inhDef.sourceChunkIds, [0]);

    const overDef = defs.find((d) => d.term === 'Method overloading');
    assert.ok(overDef);
    assert.ok(overDef.definition.includes('different parameter lists'));
    assert.deepEqual(overDef.sourceChunkIds, [1]);
});

/* ── 4. Question Answer Extraction ───────────────────────────────── */

test('4. extractAnswerForQuestion extracts source-grounded answers for study questions', () => {
    const pc = createJavaOOPProcessedContent();
    const sentences = splitSentences(pc.normalizedText);

    const ans1 = extractAnswerForQuestion('What is method overloading?', 'Method overloading', sentences, pc.chunks);
    assert.ok(ans1);
    assert.ok(ans1.answer.includes('different parameter lists'));
    assert.deepEqual(ans1.sourceChunkIds, [1]);

    const ans2 = extractAnswerForQuestion('What is encapsulation?', 'Encapsulation', sentences, pc.chunks);
    assert.ok(ans2);
    assert.ok(ans2.answer.includes('bundling data and methods'));
    assert.deepEqual(ans2.sourceChunkIds, [0]);
});

/* ── 5. Relevant Sentence Selection ──────────────────────────────── */

test('5. findRelevantSentences ranks sentences with explanatory verbs and exact terms highest', () => {
    const sentences = [
        { text: 'Java was released in 1995.', startOffset: 0, endOffset: 26 },
        { text: 'Polymorphism allows the same interface to behave in different ways.', startOffset: 30, endOffset: 99 },
        { text: 'Many developers use Java every day.', startOffset: 105, endOffset: 139 },
    ];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 150 }];

    const matches = findRelevantSentences('Polymorphism', sentences, chunks);
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].text, 'Polymorphism allows the same interface to behave in different ways.');
    assert.ok(matches[0].score >= 25);
});

/* ── 6. Irrelevant Sentence Rejection ────────────────────────────── */

test('6. Irrelevant passing mentions without explanatory structure are rejected', () => {
    const sentences = [
        { text: 'This program was created in California.', startOffset: 0, endOffset: 39 },
        { text: 'The team worked in California for two weeks.', startOffset: 45, endOffset: 89 },
    ];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 100 }];

    // Term "California" is only a passing mention (prepositional object), not an explanation
    const evidence = extractEvidenceForTerm('California', sentences, chunks);
    assert.equal(evidence, null, 'Passing mentions should not produce fake explanations');
});

/* ── 7. SourceChunkIds Preservation ──────────────────────────────── */

test('7. Source chunk traceability is preserved across learning outputs, flashcards, and quizzes', () => {
    const pc = createJavaOOPProcessedContent();
    const outputs = generateLearningOutputs(pc);

    outputs.forEach((out) => {
        assert.ok(Array.isArray(out.sourceChunkIds), `Output ${out.type} must have sourceChunkIds array`);
        assert.ok(out.sourceChunkIds.length > 0, `Output ${out.type} must retain non-empty sourceChunkIds`);
    });

    const flashcards = generateFlashcards(outputs, pc.resourceId);
    flashcards.forEach((card) => {
        assert.ok(Array.isArray(card.sourceChunkIds));
        assert.ok(card.sourceChunkIds.length > 0);
    });

    const quiz = generateQuiz(outputs, { id: pc.resourceId, title: 'Java OOP' });
    quiz.questions.forEach((q) => {
        assert.ok(Array.isArray(q.sourceChunkIds));
        assert.ok(q.sourceChunkIds.length > 0);
    });
});

/* ── 8. Empty Evidence Rejection ─────────────────────────────────── */

test('8. Never fabricates answers when source content does not contain evidence', () => {
    const sentences = [
        { text: 'The sky is blue today.', startOffset: 0, endOffset: 22 },
    ];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 30 }];

    const noEvidence = extractEvidenceForTerm('Quantum Computing', sentences, chunks);
    assert.equal(noEvidence, null);

    const noAnswer = extractAnswerForQuestion('What is Quantum Computing?', 'Quantum Computing', sentences, chunks);
    assert.equal(noAnswer, null);
});

/* ── 9. Generic-Answer Rejection ─────────────────────────────────── */

test('9. validateLearningAnswer rejects generic placeholders, short fragments, and non-substantive text', () => {
    assert.equal(validateLearningAnswer('Key concept identified in this resource.'), false);
    assert.equal(validateLearningAnswer('Review concept: Polymorphism'), false);
    assert.equal(validateLearningAnswer('Answer unavailable'), false);
    assert.equal(validateLearningAnswer('abc'), false); // Too short
    assert.equal(validateLearningAnswer('123456789'), false); // No letters
    assert.equal(validateLearningAnswer('.......'), false); // Punctuation only

    assert.equal(validateLearningAnswer('Allows one class to acquire properties and methods from another class.'), true);
    assert.equal(validateLearningAnswer('Bundles data and methods into a single unit.'), true);
});

/* ── 10. Flashcard Answer Generation Quality ─────────────────────── */

test('10. Flashcards generated from grounded outputs have substantive answers on back', () => {
    const pc = createJavaOOPProcessedContent();
    const outputs = generateLearningOutputs(pc);
    const flashcards = generateFlashcards(outputs, pc.resourceId, { strictQuality: true });

    assert.ok(flashcards.length >= 3);

    flashcards.forEach((card) => {
        assert.ok(card.content.front);
        assert.ok(card.content.back);
        assert.equal(isGenericPlaceholder(card.content.back), false, `Flashcard back must not be generic: "${card.content.back}"`);
        assert.ok(card.content.back.length >= 10);
    });
});

/* ── 11. Quiz Correct-Answer Grounding ───────────────────────────── */

test('11. Quiz generator grounds correct answers and avoids generic placeholder options', () => {
    const pc = createJavaOOPProcessedContent();
    const outputs = generateLearningOutputs(pc);
    const quiz = generateQuiz(outputs, { id: pc.resourceId, title: 'Java OOP' });

    assert.ok(quiz.questions.length >= 2);

    quiz.questions.forEach((q) => {
        assert.ok(q.question);
        assert.ok(q.correctAnswer);
        assert.equal(isGenericPlaceholder(q.correctAnswer), false, `Quiz correct answer must not be placeholder: "${q.correctAnswer}"`);

        q.options.forEach((opt) => {
            assert.equal(isGenericPlaceholder(opt), false, `Quiz option must not be placeholder: "${opt}"`);
        });

        assert.ok(q.options.includes(q.correctAnswer));
    });
});

/* ── 12. Summary Quality ─────────────────────────────────────────── */

test('12. Extractive summary selects authentic sentences and filters out any placeholder statements', () => {
    const sentences = [
        { text: 'Key concept identified in this resource.', startOffset: 0, endOffset: 40 },
        { text: 'Encapsulation is the process of bundling data and methods together and controlling access to the data.', startOffset: 45, endOffset: 147 },
        { text: 'Inheritance allows one class to acquire properties and methods from another class.', startOffset: 150, endOffset: 232 },
    ];
    const concepts = [{ term: 'Encapsulation', score: 10 }, { term: 'Inheritance', score: 8 }];
    const chunks = [{ index: 0, startOffset: 0, endOffset: 250 }];

    const summary = generateExtractiveSummary(sentences, concepts, chunks);
    assert.ok(!summary.text.includes('Key concept identified in this resource.'));
    assert.ok(summary.text.includes('Encapsulation is the process'));
    assert.ok(summary.text.includes('Inheritance allows one class'));
});

/* ── 13. OCR-Derived Text Compatibility ──────────────────────────── */

test('13. Operates seamlessly on OCR-like extracted text with minor OCR artifacts', () => {
    // OCR text typically has line breaks or slight irregularities, but normalized sentences
    const ocrText = `Photosynthesis is the biological process converting light to glucose.\n\nChloroplast is the organelle that absorbs photons.`;
    const ocrProcessed = {
        id: 'proc-ocr-1',
        resourceId: 'res-ocr-img',
        normalizedText: ocrText,
        chunks: [
            { index: 0, startOffset: 0, endOffset: 70, text: 'Photosynthesis is the biological process converting light to glucose.\n\n' },
            { index: 1, startOffset: 70, endOffset: ocrText.length, text: 'Chloroplast is the organelle that absorbs photons.' },
        ],
        sourceType: 'image',
        metadata: { entryMethod: 'ocr' },
        createdAt: '2026-09-27T10:00:00.000Z',
        updatedAt: '2026-09-27T10:00:00.000Z',
    };

    const outputs = generateLearningOutputs(ocrProcessed);
    assert.ok(outputs.length >= 2);

    const defs = outputs.filter((o) => o.type === 'definition');
    assert.ok(defs.length >= 1);
    assert.ok(defs[0].content.includes('Photosynthesis'));

    const cards = generateFlashcards(outputs, ocrProcessed.resourceId);
    assert.ok(cards.length >= 1);
    assert.equal(isGenericPlaceholder(cards[0].content.back), false);
});

/* ── 14. PDF-Derived Text Compatibility ──────────────────────────── */

test('14. Operates seamlessly on multi-page PDF text with page boundary metadata', () => {
    const pdfText = `Page 1: Encapsulation is bundling data and methods together.\n\nPage 2: Inheritance allows code reuse across class hierarchies.`;
    const pdfProcessed = {
        id: 'proc-pdf-1',
        resourceId: 'res-pdf-doc',
        normalizedText: pdfText,
        chunks: [
            { index: 0, startOffset: 0, endOffset: 61, text: 'Page 1: Encapsulation is bundling data and methods together.\n\n', pageNumber: 1 },
            { index: 1, startOffset: 61, endOffset: pdfText.length, text: 'Page 2: Inheritance allows code reuse across class hierarchies.', pageNumber: 2 },
        ],
        sourceType: 'pdf',
        metadata: { entryMethod: 'pdf' },
        createdAt: '2026-09-27T10:00:00.000Z',
        updatedAt: '2026-09-27T10:00:00.000Z',
    };

    const outputs = generateLearningOutputs(pdfProcessed);
    assert.ok(outputs.length >= 2);

    // Verify chunk page attribution preserved
    const inh = outputs.find((o) => o.content.includes('Inheritance'));
    assert.ok(inh);
    assert.ok(inh.sourceChunkIds.includes(1));
});

/* ── 15. Text-Resource Compatibility ─────────────────────────────── */

test('15. Operates seamlessly on standard manual text resource', () => {
    const pc = createJavaOOPProcessedContent();
    const outputs = generateLearningOutputs(pc);

    assert.ok(outputs.length > 0);
    const types = new Set(outputs.map((o) => o.type));
    assert.ok(types.has('summary'));
    assert.ok(types.has('concept'));
    assert.ok(types.has('definition'));
    assert.ok(types.has('question'));
});

/* ── 16. Deterministic Repeated Generation ───────────────────────── */

test('16. Repeated generation on the same source content produces 100% identical outputs', () => {
    const pc = createJavaOOPProcessedContent();

    const run1 = generateLearningOutputs(pc, { idGenerator: () => 'static-id', clock: () => '2026-09-27T10:00:00.000Z' });
    const run2 = generateLearningOutputs(pc, { idGenerator: () => 'static-id', clock: () => '2026-09-27T10:00:00.000Z' });

    assert.equal(run1.length, run2.length);
    for (let i = 0; i < run1.length; i++) {
        assert.equal(run1[i].type, run2[i].type);
        assert.deepEqual(run1[i].content, run2[i].content);
        assert.deepEqual(run1[i].sourceChunkIds, run2[i].sourceChunkIds);
        assert.deepEqual(run1[i].metadata, run2[i].metadata);
    }
});

/* ── 17. No Random Output Changes ────────────────────────────────── */

test('17. Shuffling in quiz generation is deterministic based on string hash seed', () => {
    const pc = createJavaOOPProcessedContent();
    const outputs = generateLearningOutputs(pc);

    const quiz1 = generateQuiz(outputs, { id: pc.resourceId, title: 'OOP' }, { idGenerator: () => 'q-1', clock: () => '2026-09-27T10:00:00.000Z' });
    const quiz2 = generateQuiz(outputs, { id: pc.resourceId, title: 'OOP' }, { idGenerator: () => 'q-1', clock: () => '2026-09-27T10:00:00.000Z' });

    assert.equal(quiz1.questions.length, quiz2.questions.length);
    for (let i = 0; i < quiz1.questions.length; i++) {
        assert.deepEqual(quiz1.questions[i].options, quiz2.questions[i].options);
        assert.equal(quiz1.questions[i].correctAnswer, quiz2.questions[i].correctAnswer);
    }
});

/* ── 18. Explicit Regression Test for Original Problem ───────────── */

test('18. REGRESSION: Concept "Inheritance" NEVER produces "Key concept identified in this resource"', () => {
    const pc = createJavaOOPProcessedContent();
    const outputs = generateLearningOutputs(pc);

    const inhConcept = outputs.find((o) => o.type === 'concept' && o.metadata?.term === 'Inheritance');
    assert.ok(inhConcept, 'Inheritance must be extracted as a key concept');

    // Check explanation in metadata
    assert.notEqual(
        inhConcept.metadata?.explanation,
        'Key concept identified in this resource.',
        'Concept explanation must NOT be generic placeholder',
    );
    assert.ok(
        inhConcept.metadata?.explanation?.includes('acquire properties and methods'),
        `Explanation must be source-grounded, got: "${inhConcept.metadata?.explanation}"`,
    );

    // Check flashcard back
    const flashcards = generateFlashcards(outputs, pc.resourceId, { strictQuality: true });
    const inhCard = flashcards.find((c) => c.content.front.includes('Inheritance'));
    assert.ok(inhCard, 'Flashcard for Inheritance must be generated');

    assert.notEqual(
        inhCard.content.back,
        'Key concept identified in this resource.',
        'Flashcard back MUST NOT be the old generic placeholder',
    );
    assert.ok(
        inhCard.content.back.includes('acquire properties and methods'),
        `Flashcard back must contain meaningful source evidence, got: "${inhCard.content.back}"`,
    );
});
