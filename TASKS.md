# Task backlog

## Completed — Day 1 through Day 11

- [x] Create the framework-free project scaffold.
- [x] Build a responsive application shell with Dashboard, Library, Notes, Flashcards, Quizzes, Analytics, and Settings routes.
- [x] Add accessible hash-based client-side navigation and mobile off-canvas navigation.
- [x] Establish reusable button, card, input, empty-state, badge, modal, and navigation styles.
- [x] Create honest empty states and placeholder actions for future source imports and learning tools.
- [x] Add a focused route-registry test using the built-in Node test runner.
- [x] Add the versioned StudyLensDB IndexedDB database with a resources object store and justified indexes.
- [x] Create the extensible Resource model, validation, UUID generation, and repository CRUD API.
- [x] Initialise storage during application startup and connect the Dashboard resource count to real local data.
- [x] Add validation tests and a self-cleaning native-browser IndexedDB CRUD suite.
- [x] Add safe manual text-resource create, reader, edit, and confirmed delete workflows through ResourceRepository.
- [x] Render real recent resources and Library resource cards from IndexedDB.
- [x] Refresh the Dashboard count and resource displays after resource mutations without reloading.
- [x] Add focused text-input normalization and safe content-rendering tests.
- [x] Add local Library search across title, content, and tags.
- [x] Add resource type and status filters with clear-filters control.
- [x] Add five-option sort control and result count display.
- [x] Add distinct empty states for no resources and no matching results.
- [x] Add a pure, testable search module and comprehensive search tests.
- [x] Centralize tag normalization with lowercase, dedup, and validation limits.
- [x] Add tag-based Library filtering with dynamic tag dropdown.
- [x] Update Library pipeline to include tag filter stage.
- [x] Improve resource viewer metadata with updated dates and source display.
- [x] Add comprehensive tag utility and tag filter tests.
- [x] Define the in-memory NormalizedContent and ordered ContentSegment models.
- [x] Add a plain-object source-adapter contract and the text-only TextAdapter.
- [x] Add deterministic text normalization and paragraph-aware configurable chunking.
- [x] Add a validated local processing pipeline with useful unsupported-resource and missing-content errors.
- [x] Add focused adapter, normalization, chunking, and pipeline tests.
- [x] Upgrade StudyLensDB to schema version 2 with a processedContent object store and unique resourceId index.
- [x] Implement ProcessedContentRepository with save, getByResourceId, deleteByResourceId, and clear.
- [x] Connect text resource creation and edit workflows to the processing pipeline.
- [x] Implement automatic reprocessing on edit, invalidating stale processed data while preserving resource ID and createdAt.
- [x] Handle processing failures gracefully by preserving original text, updating status to failed, and storing error metadata.
- [x] Update resource viewer to retrieve processed content and display a lightweight chunk count indicator.
- [x] Clean up associated processed content when a resource is deleted.
- [x] Add comprehensive processing integration tests and verify full regression suite.
- [x] Upgrade StudyLensDB to schema version 3 with the `learningOutputs` object store and indexes (`resourceId`, `type`, `createdAt`, `sourceChunkIds`).
- [x] Create the `LearningOutput` data model, validation schema, and CRUD repository (`LearningOutputRepository`).
- [x] Implement deterministic sentence segmentation with character offset tracking and chunk ID mapping.
- [x] Implement deterministic concept extraction using term frequency, title capitalization, and stopword exclusion.
- [x] Implement deterministic pattern-based definition extraction ("is", "means", "refers to", "defined as").
- [x] Implement grounded question generation from extracted definitions and concepts.
- [x] Implement deterministic extractive summarization ranking salient sentences with position and concept overlap weights.
- [x] Create `LearningOutputGenerator` converting content analysis into validated `LearningOutput` records with mandatory `sourceChunkIds`.
- [x] Create `learningOutputService` orchestrating analysis, persistence, automatic deduplication on regeneration, summary queries, and cleanup.
- [x] Add Resource Viewer UI action ("Generate learning outputs") and outputs summary badge display.
- [x] Add comprehensive unit and integration tests for Day 9 persistence and Day 10 deterministic learning outputs.
- [x] Create `js/features/learningOutputView.js` for safe DOM rendering of structured learning output sections (Summary, Key Concepts, Definitions, Questions).
- [x] Implement human-friendly source traceability labels and badges (`sourceChunkIds`).
- [x] Implement responsive card, list, and chip layouts in `css/components.css` matching design tokens.
- [x] Add empty state, loading spinner, and error state views within the Resource Viewer.
- [x] Improve generation UX in `js/features/resourceViewer.js` with concurrency guards, button transitions ("Generate learning outputs" → "Generating…" → "Regenerate learning outputs"), and feedback toasts.
- [x] Fix modal viewport overflow by adding dialog scrolling (`max-height: calc(100dvh - 2.5rem); overflow-y: auto`).
- [x] Add 14 comprehensive unit and integration tests in `tests/learningOutputView.test.mjs`.
- [x] Create deterministic flashcard generator (`js/processing/flashcardGenerator.js`) converting definitions, questions, and concepts into structured `{ front, back }` records with preserved `sourceChunkIds`.
- [x] Create flashcard orchestration service (`js/features/flashcardService.js`) handling generation, persistence in `learningOutputs` store, deduplication on regeneration, deck retrieval, and cleanup.
- [x] Integrate "Generate flashcards" / "Regenerate flashcards" action and summary reporting into the Resource Viewer (`js/features/resourceViewer.js`, `js/features/learningOutputView.js`).
- [x] Create interactive Flashcard Study Viewer (`js/features/flashcardViewer.js`, `index.html`) with CSS 3D card flip, previous/next navigation, progress indicator ("Card X of Y"), completion bar, and keyboard controls (<kbd>Space</kbd>/<kbd>Enter</kbd>, <kbd>←</kbd>/<kbd>→</kbd>, <kbd>Escape</kbd>).
- [x] Build active Flashcards main page (`js/features/flashcardPage.js`, `index.html`) with deck cards grouped by resource, card count badges, previews, and "Study deck" triggers.
- [x] Connect Dashboard Flashcards stat counter (`storageStatus.js`) to durable local storage with reactive event updates.
- [x] Add responsive CSS styles for deck grids, 3D flip card, and mobile dialog actions (`css/components.css`, `css/responsive.css`).
- [x] Add 21 comprehensive unit, service, and DOM component tests in `tests/flashcards.test.mjs`.

## Next

- [ ] Implement quiz challenge engine and interactive practice views built upon generated questions and definitions.

## Explicitly deferred

No external AI or LLM APIs; external NLP libraries; spaced repetition algorithms (Leitner, SM-2); interactive quiz test sessions; notes workspace; PDF, image, or video extraction; OCR; PDF parsing; video transcripts; analytics calculations; authentication; or backend services have been implemented. Only manually entered text has an active adapter, end-to-end processing pipeline, deterministic learning output generator, structured reader UI, and interactive flashcard review engine today.
