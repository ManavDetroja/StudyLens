# Changelog

## 0.15.0 — 2026-09-26

- Implemented the complete, persistent Notes Workspace in StudyLens without backend services, external libraries, cloud storage, or AI/LLM APIs.
- Upgraded StudyLensDB to schema version 6, introducing the dedicated `notes` object store with indexes on `resourceId`, `updatedAt`, and `createdAt`.
- Added `js/storage/noteValidation.js` and `js/storage/noteStore.js` with full validation, schema enforcement (immutable `id` and `createdAt`, updating `updatedAt`), and CRUD operations via `NoteRepository`.
- Added `js/features/noteService.js` coordinating note CRUD operations, event notifications (`noteschanged`), pure deterministic local substring search across title, content, and tags, and resource-based filtering (`all`, `standalone`, or specific `resourceId`).
- Activated the Notes section (`#notes`, `index.html`, `js/features/notesPage.js`, `css/components.css`, `css/responsive.css`):
  - Responsive 3-column notes grid (`.notes-grid`) with responsive breakpoints for tablet (2 columns) and mobile (1 column).
  - Search toolbar with real-time text input (`[data-notes-search]`), resource filter dropdown (`[data-notes-resource-filter]`), and clear button.
  - Accessible Note cards with titles, linked resource badges, multi-line content previews, tag lists, relative update dates, and edit/delete actions.
  - Empty states for both initial zero-note state and zero-match search/filter state with clear search action.
- Built the Note Editor dialog (`#note-editor-dialog`, `js/features/noteEditor.js`) supporting:
  - Creating standalone notes or linking notes to any library resource via dynamically populated resource selector.
  - Editing existing notes, preserving original `id` and `createdAt` while updating `updatedAt`.
  - Explicit save action on form submit with client-side length validations (`NOTE_TITLE_MAX_LENGTH = 200`, `NOTE_CONTENT_MAX_LENGTH = 100000`).
  - Delete Note confirmation dialog (`#delete-note-dialog`) preventing accidental note deletion.
- Integrated Resource Viewer with Notes Workspace:
  - Added "Add note" action button in `#resource-viewer-dialog` footer that pre-populates note title (`Notes — {title}`), resource link, and tags.
  - Added cascading note cleanup in `js/features/resourceViewer.js`: deleting a parent resource automatically deletes all its associated notes.
- Connected the live Dashboard Notes stat counter (`<strong data-stat="notes">`, `js/features/storageStatus.js`) with reactive `onNotesChanged` updates.
- Ensured strict safe rendering: all user note text, titles, and tags render strictly via `textContent`, with zero HTML interpretation and verified XSS attack prevention.
- Added 24 comprehensive unit, validation, service, event, safe-rendering, and cascading cleanup tests in `tests/notes.test.mjs` (248 tests total across the suite, 247 passing in Node, 1 skipped for browser-only IndexedDB).
- Updated and verified the native IndexedDB browser test suite (`tests/storage.browser-suite.js`, `tests/storage.browser.html`) with schema v6 assertions (18 passed checks).
- Verified complete end-to-end functionality via automated headless Chrome CDP browser audit across 14 verification steps.

## 0.14.0 — 2026-09-26

- Implemented persistent Quiz Attempt Results & Basic Analytics in StudyLens without backend services, external libraries, cloud storage, or AI APIs.
- Upgraded StudyLensDB to schema version 5, adding the dedicated `quizAttempts` object store with indexes on `quizId`, `resourceId`, `completedAt`, and `createdAt`.
- Added `js/storage/quizAttemptValidation.js` and `js/storage/quizAttemptStore.js` with full validation, schema enforcement, and CRUD operations via `QuizAttemptRepository`.
- Added `js/processing/quizScoreCalculator.js` for pure deterministic evaluation of quiz answers, returning score, percentage, correct/incorrect/unanswered counts, and per-question breakdowns with source chunk grounding.
- Added `js/features/quizAttemptService.js` for recording completed attempts, querying attempts by quiz, by resource, or globally, and handling cascading cleanup on resource deletion.
- Added `js/features/analyticsService.js` to derive performance analytics purely from stored attempts (total attempts, unique quizzes taken, average score percentage, highest score percentage, and recent activity).
- Enhanced the Quiz Player modal (`js/features/quizPlayer.js`, `index.html`, `css/components.css`) to:
  - Persist an independent attempt record upon submission via `recordQuizAttempt`.
  - Display score statistics chips (Correct, Incorrect, Unanswered count badges).
  - Surface detailed per-question review with answer status and source grounding tags.
  - Provide an Attempt History view listing all past sessions for the active quiz with direct "Review" capabilities.
  - Reset in memory upon Retry without persisting premature/empty attempts until explicit re-submission.
- Added direct "History" action button on quiz cards in the Quizzes section (`js/features/quizPage.js`) allowing one-click access to past attempt history.
- Activated the Quiz Analytics page (`#analytics`, `js/features/analyticsPage.js`, `index.html`) featuring:
  - Real-time aggregate metric cards: Total attempts, Quizzes taken, Average score, Highest score.
  - Chronological recent activity feed with performance badges, score percentages, and "Retake" shortcuts.
  - Dedicated empty state with guidance to complete quizzes from the library.
  - Full reactive synchronization via `onQuizAttemptsChanged`, `onQuizzesChanged`, and `onResourcesChanged`.
- Integrated cascading attempt cleanup in `js/features/resourceViewer.js` when deleting a parent resource.
- Added 24 unit, calculation, service, and UI controller tests in `tests/quizAttempts.test.mjs` (224 tests total across the suite, 223 passing in Node, 1 skipped for browser-only IndexedDB).
- Updated and verified the native IndexedDB browser test suite (`tests/storage.browser-suite.js`, `tests/storage.browser.html`) with schema v5 assertions.
- Verified complete end-to-end functionality via automated headless Chrome CDP browser audit.

## 0.13.0 — 2026-09-25

- Implemented the complete Quiz System with deterministic multiple-choice question generation from local learning content (definitions, concepts, questions) without AI/LLM APIs, external NLP, vector DBs, or backend services.
- Upgraded StudyLensDB to schema version 4, adding the dedicated `quizzes` object store with indexes on `resourceId` and `createdAt`.
- Added `js/storage/quizValidation.js` and `js/storage/quizStore.js` with full validation, schema enforcement, and CRUD operations via `QuizRepository`.
- Added `js/processing/quizGenerator.js` for deterministic multiple-choice question generation with authentic distractors drawn directly from same-resource terms and definitions, preserving `sourceChunkIds` for full source grounding.
- Added `js/features/quizService.js` for quiz orchestration, duplicate-safe generation/regeneration (replaces old quiz without leaking records), cascading deletion on resource removal, and reactive updates.
- Integrated "Generate quiz" / "Regenerate quiz" action and preview section into the Resource Viewer (`js/features/resourceViewer.js`, `js/features/learningOutputView.js`, `index.html`).
- Built the interactive Quiz Player modal (`js/features/quizPlayer.js`, `index.html`, `css/components.css`) featuring:
  - Step-by-step single question view with clear option selection buttons and letter indicators (A, B, C, D).
  - Navigation controls (Previous and Next) preserving temporary answer selections in memory.
  - Progress indicator ("Question X of Y") and animated progress bar.
  - Final submission calculation: score calculation (`X / Y Correct (Z%)`) and question-by-question result breakdown with correct/incorrect indicators.
  - In-place Retry action: resets answers and restarts at question 1 without altering the stored quiz record in IndexedDB.
  - Full safe text rendering (`textContent` exclusively, XSS resistant).
- Activated the Quizzes navigation section (`#quizzes`, `js/features/quizPage.js`) with responsive card deck list, question count badges, first question preview, and "Take quiz" launchers.
- Added live Dashboard Quizzes stat counter (`js/features/storageStatus.js`, `index.html`) with reactive `quizzeschanged` event listening.
- Added 23 comprehensive unit, service, generator, and UI controller tests in `tests/quizzes.test.mjs` (200 tests total across the suite, 199 passing in Node, 1 skipped for browser-only IndexedDB).
- Verified end-to-end functionality via automated headless Chrome browser audit and updated browser storage suite (`tests/storage.browser.html`).

## 0.12.0 — 2026-09-25

- Implemented deterministic flashcard generation from existing learning outputs (definitions, questions, concepts) into structured `{ front, back }` flashcard records with full `sourceChunkIds` source traceability.
- Added `js/processing/flashcardGenerator.js` for pure, deterministic conversion without hallucinated answers or external NLP/AI libraries.
- Added `js/features/flashcardService.js` for orchestration, persistence in the existing `learningOutputs` store (`type: 'flashcard'`), clean regeneration replacement without duplicates, deck grouping by resource, and resource cleanup.
- Integrated "Generate flashcards" / "Regenerate flashcards" action, flashcard summary reporting, and deck study shortcut into the Resource Viewer (`js/features/resourceViewer.js`, `index.html`, `js/features/learningOutputView.js`).
- Built the interactive Flashcard Study Viewer (`js/features/flashcardViewer.js`, `index.html`, `css/components.css`) featuring:
  - 3D CSS flip animation between question/prompt (front) and answer/explanation (back).
  - Next and Previous navigation with card progress tracking ("Card X of Y") and animated completion bar.
  - Full keyboard accessibility: <kbd>Space</kbd> / <kbd>Enter</kbd> to flip, <kbd>←</kbd> and <kbd>→</kbd> to navigate cards, <kbd>Escape</kbd> to close.
  - Source chunk traceability badge display on cards.
- Transformed the Flashcards navigation section (`#flashcards`, `js/features/flashcardPage.js`) into an active deck collection page with resource-grouped cards, card counts, previews, and "Study deck" launchers.
- Connected the Dashboard Flashcards stat card (`storageStatus.js`) to durable local storage with reactive event updates.
- Added 21 comprehensive unit, service, and DOM component tests in `tests/flashcards.test.mjs` (177 tests total, 176 passed, 0 failed, 1 skipped).

## 0.11.0 — 2026-09-23

- Built the complete Learning Outputs user experience in the Resource Viewer without external frameworks or AI APIs.
- Added `js/features/learningOutputView.js` for safe DOM rendering (textContent only) of categorized study aids:
  - Extractive Summary card with source traceability badge.
  - Key Concepts chip list with term labels, frequency scores, and grounded chunk badges.
  - Definitions section with term and definition separation.
  - Numbered Study Questions list linked to source chunks.
- Handled empty, loading (spinner), and error states directly within the modal.
- Improved generation UX in `js/features/resourceViewer.js`: concurrency guard against simultaneous generation, button state transitions ("Generate learning outputs" → "Generating…" → "Regenerate learning outputs"), disable state for empty resources, and toast feedback.
- Updated `index.html` and `css/components.css` with structured output containers, responsive card layouts, and dialog scrollability (`max-height: calc(100dvh - 2.5rem); overflow-y: auto`).
- Added 14 unit and integration tests in `tests/learningOutputView.test.mjs` (155 tests passing across entire suite).

## 0.10.0 — 2026-09-23

- Implemented the deterministic Learning Output Engine without external AI APIs or LLMs.
- Added pure deterministic analysis algorithms in `js/processing/contentAnalysis.js`: sentence segmentation with offset tracking, chunk ID overlap calculation, key concept extraction with stopword filtering (`js/processing/stopwords.js`), definition pattern recognition ("is", "means", "refers to", "defined as"), grounded question generation, and extractive summarization.
- Added `LearningOutputGenerator` in `js/processing/learningOutputGenerator.js` to convert content analysis results into validated `summary`, `concept`, `definition`, and `question` records with mandatory `sourceChunkIds`.
- Added `learningOutputService` in `js/features/learningOutputService.js` for orchestration, summary reporting, deduplication on regeneration, and resource cleanup.
- Integrated lightweight UI action ("Generate learning outputs") and outputs summary badge into Resource Viewer (`js/features/resourceViewer.js`, `index.html`, `css/components.css`).
- Added 15 comprehensive unit and service integration tests in `tests/deterministicLearningOutputs.test.mjs` (142 tests passing across suite).

## 0.9.0 — 2026-09-23

- Established the Learning Output Foundation and persistence layer.
- Upgraded StudyLensDB to schema version 3, introducing the `learningOutputs` object store with indexes on `resourceId`, `type`, `createdAt`, and multi-entry `sourceChunkIds`.
- Added `LearningOutput` data model, type definitions, and validation rules in `js/storage/learningOutputValidation.js` and `ts/types.ts`.
- Implemented `LearningOutputRepository` in `js/storage/learningOutputStore.js` with CRUD methods, resource-specific queries, type queries, and bulk deletion.
- Added 18 unit tests for schema, validation, and repository operations in `tests/learningOutput.test.mjs`.

## 0.8.0 — 2026-09-22

- Connected the Day 7 content processing pipeline to persistent storage and the Text Resource workflow.
- Upgraded StudyLensDB to schema version 2 with a new `processedContent` object store and unique `resourceId` index.
- Added `ProcessedContentRepository` in `js/storage/processedContentStore.js` with save, get, delete, count, and clear methods.
- Added processing service in `js/features/processingIntegration.js` for executing processing, retrieval, and cleanup.
- Added automatic text resource processing on creation and automatic reprocessing on edit.
- Enforced stale processed content invalidation on edit so old versions are never silently returned.
- Preserved original resource ID and createdAt on edit while updating updatedAt and storing fresh processed content.
- Handled processing errors safely: kept original text intact, updated status to `failed`, and recorded failure metadata.
- Updated the resource viewer to display a lightweight chunk count indicator and clean up processed records upon resource deletion.
- Added 14 new tests in `tests/processingIntegration.test.mjs` and updated browser storage suite (108 tests total).

## 0.7.0 — 2026-09-21

- Added the in-memory NormalizedContent and ContentSegment type definitions for future learning workflows.
- Added a plain-object content adapter contract and the text-only TextAdapter.
- Added deterministic text normalization for line endings, horizontal whitespace, blank lines, and document edges.
- Added paragraph-aware, configurable, lossless text chunking with ordered source offsets.
- Added ContentProcessingPipeline with validated adapter selection and useful processing error codes.
- Added 15 focused tests for the normalizer, chunker, text adapter, and processing pipeline.
- Kept processing out of the UI and IndexedDB: no automatic processing, new schema, or stored outputs.

## 0.6.0 — 2026-09-21

- Centralized tag normalization in js/utils/tagUtils.js with lowercase, trim, and deduplication.
- Added tag validation with configurable limits: 20 tags per resource, 50 characters per tag.
- Added tag-based filtering in the Library with a dynamically populated dropdown.
- Updated the Library filter pipeline to search, type, status, tag, then sort.
- Improved the resource viewer with updated timestamps and source metadata display.
- Added tag overflow protection and source styling in CSS.
- Added 35 new tests for tag utilities and tag filtering (78 total).

## 0.5.0 — 2026-09-19

- Added local Library search across resource title, content, and tags with case-insensitive substring matching.
- Added resource type filter, resource status filter, and five-option sort control.
- Added result count display, clear-filters control, and distinct empty states for no resources and no matching results.
- Added the pure search module js/algorithms/librarySearch.js with the documented filter pipeline.
- Added comprehensive search, filter, sort, and combined-filter tests.
- Updated the Library toolbar to a four-control layout with responsive tablet and mobile stacking.

## 0.4.0 — 2026-09-19

- Added the manual Add Text workflow with title, content, and normalized comma-separated tags.
- Added ResourceRepository-backed text-resource creation, reader, edit, and confirmed deletion flows.
- Added real Dashboard resource counts and recent resources, plus real Library resource cards.
- Added safe text-only resource-content rendering and focused Day 4 tests.
- Added concise AGENTS.md repository guidance.

## 0.3.0 — 2026-09-18

- Added StudyLensDB, schema version 1, and the resources IndexedDB object store.
- Added type, createdAt, updatedAt, and status indexes for future library and processing workflows.
- Added the validated Resource model, crypto.randomUUID identifiers, statuses, metadata, and resource repository CRUD API.
- Initialised local storage at startup, surfaced storage failures in the UI, and connected the Dashboard resource count to IndexedDB.
- Added Node validation tests and a self-cleaning native-browser IndexedDB CRUD test suite.
- Documented schema migration and current storage limitations.

## 0.2.0 — 2026-09-18

- Added the responsive StudyLens application shell and seven in-place pages.
- Added accessible hash navigation, active states, browser-history support, and mobile off-canvas navigation.
- Added Dashboard quick-action placeholders, zero-valued stat cards, empty recent resources, and the getting-started workflow.
- Added honest Library, Notes, Flashcards, Quizzes, Analytics, and Settings shells with reusable UI patterns.
- Split UI styling into token, layout, component, and responsive layers.
- Documented the Day 2 navigation and responsive design decisions.

## 0.1.0 — 2026-09-18

- Created the project scaffold, documentation, minimal UI, and placeholder JavaScript modules.
