# Roadmap

## V1 — Foundation

- Day 1: Project scaffold and architecture baseline. Complete.
- Day 2: Responsive application shell, UI system, and placeholder page states. Complete.
- Day 3: Versioned IndexedDB storage, Resource model, repository CRUD API, and tests. Complete.
- Day 4: Text-resource create, read, edit, delete, Dashboard, and Library integration. Complete.
- Day 5: Local Library search, type and status filtering, sorting, result counts, and clear-filters control. Complete.
- Day 6: Centralized tag system, tag-based Library filtering, resource metadata improvements. Complete.
- Day 7: Text-only content-processing foundation: normalization, chunking, adapter contract, pipeline, and tests. Complete.
- Day 8: Processing integration & milestone completion: end-to-end Text Resource processing, StudyLensDB v2 (`processedContent` store), reprocessing on edit, failure handling, viewer indicator, and cleanup. Complete.
- Day 9: Learning Output foundation & persistence: StudyLensDB v3 (`learningOutputs` store), LearningOutput model, validation, repository, and tests. Complete.
- Day 10: Deterministic learning output engine: content analysis, extractive summary, concept extraction, definition extraction, question generation, source chunk traceability, and viewer integration. Complete.
- Day 11: Learning Outputs UI & Experience: complete user experience in Resource Viewer for Summary, Key Concepts, Definitions, and Questions with source traceability, loading states, error states, and safe regeneration. Complete.
- Day 12: Flashcards feature: deterministic generation from definitions, questions, and concepts; persistence in learningOutputs store; deck collection page; and interactive 3D flip-card study viewer with keyboard navigation. Complete.
- Day 13: Deterministic Quiz system: multiple-choice generation, StudyLensDB v4 (`quizzes` store), interactive quiz player, option selection, score calculation, in-place retry, Quizzes page, and viewer integration. Complete.
- Day 14: Persistent Quiz Attempt Results & Basic Analytics: StudyLensDB v5 (`quizAttempts` store), QuizAttempt and QuestionResult models, deterministic score calculation, persistent attempt recording, Quiz Player results & attempt history modal, Quizzes page History action, reactive Quiz Analytics page (`#analytics`), and cascading deletion. Complete.
- Day 15: Persistent Notes Workspace: StudyLensDB v6 (`notes` store), Note model, NoteRepository, NoteService, dedicated Notes page (`#notes`) with responsive grid, search & resource filtering, Note Editor dialog with standalone & linked modes, Resource Viewer integration, dashboard counter, and cascading deletion. Complete.
- Day 16: Local File Import Foundation: client-side PDF and image ingestion, StudyLensDB v7 (`fileBlobs` store), FileBlobRepository, file validation and size enforcement, file import dialog with live preview, Dashboard quick actions, Resource Viewer file info & image preview with object URL lifecycle, and cascading delete. Complete.
- Day 17: Browser-based PDF Text Extraction: offline PDF.js integration, pure client-side page-by-page text extractor, PDF Source Adapter, content processing pipeline integration with chunk page traceability, status lifecycle management, Resource Viewer extraction controls & multi-page formatting, and seamless downstream learning output, flashcard, and quiz generation. Complete.
- Day 18: Local Image OCR Extraction: client-side image processing, normalized text conversion, and chunk integration. Complete.
- Day 19: Deterministic Source-Grounded Learning Output Quality Engine: pure client-side evidence retrieval and relevance layer (`evidenceRetrieval.js`), forbidden placeholder rejection (`isGenericPlaceholder`), substantive answer validation (`validateLearningAnswer`), expanded definition patterns 1–9, source-grounded concept explanations, source-supported question answers, grounded flashcard backs, authentic MCQs, and exact source chunk traceability. Complete. Day 19 improves deterministic source-grounded output quality. It does not introduce an LLM.
- Next: Day 20 — Video transcript extraction or spaced repetition review.

## V2 — Content processing

- Source adapters for video URLs.
- AI provider integration and generation of learning outputs.

## V3 — Learning intelligence

- Searchable knowledge library.
- Spaced repetition review and knowledge retention tracking.
- Advanced analytics, spaced repetition algorithms, and knowledge-graph capabilities.

Only the Day 17–19 text-, PDF-, and image-processing pipeline, local file import foundation, persistent storage (StudyLensDB v8), deterministic source-grounded learning output engine, structured reader UI, flashcards study system with grounded card backs, interactive quiz player with grounded MCQs, persistent quiz attempt results & basic analytics, and persistent notes workspace are implemented now. Additional V2 and all V3 items are plans, not active features.



