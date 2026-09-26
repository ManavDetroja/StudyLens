# Architecture overview

## Day 2 application shell

StudyLens is a client-side, framework-free single-page application. The root HTML contains the semantic, static application shell and one section per route. JavaScript changes only the active section, page metadata, and mobile navigation state; it does not generate the static UI.

## Navigation

js/core/routes.js is the single source of route metadata. js/ui/navigation.js maps the URL hash to a route, updates the active navigation item and visible page, and keeps browser back/forward navigation working without a full reload. The supported routes are #dashboard, #library, #notes, #flashcards, #quizzes, #analytics, and #settings.

This lightweight hash approach was selected over a router because the project is a static, client-side application and does not need framework routing or server rewrite rules.

## UI modules

- js/app.js only boots independent modules.
- js/ui/navigation.js owns route and responsive-navigation state.
- js/ui/modal.js exposes the shared native-dialog modal.
- js/features/resourceForm.js owns the Day 2 quick-action placeholders; it does not upload or process anything.
- CSS is split into design tokens (variables.css), layout (main.css), reusable patterns (components.css), and breakpoints (responsive.css).

## Responsive strategy

Desktop uses a persistent sidebar. Tablet preserves the compact sidebar while content cards reflow. Below 768px the sidebar becomes an off-canvas navigation panel opened by a labelled header button; the backdrop and Escape key close it. The layout has a 320px minimum width and grids collapse progressively to prevent horizontal overflow.

## Resource feature data flow

The Day 4 manual text workflow follows the storage boundary:

    Text form / resource reader / Library
      ↓
    textResourceInput.js and feature modules
      ↓
    ResourceRepository
      ↓
    IndexedDB connection

js/features/resourceForm.js owns form state and turns valid form fields into a text-resource input. It never creates database requests. js/features/resourceList.js reads the repository and renders Dashboard recent resources and the Library list with safe DOM methods. js/features/resourceViewer.js reads, edits, and deletes a selected resource through the repository.

After create, update, or delete, js/core/resourceEvents.js emits a small resourceschanged event. Resource-list refreshes the Dashboard count, recent resources, and Library without a page reload or a state-management framework.

All resource text is inserted with textContent. The viewer does not interpret user content as HTML.

## IndexedDB storage foundation

StudyLens uses the browser native IndexedDB API behind a storage boundary:

    UI
      ↓
    Feature logic
      ↓
    Resource repository
      ↓
    IndexedDB connection

The UI never opens IndexedDB directly. js/features/storageStatus.js coordinates application startup and Dashboard resource-count display. It calls the storage modules and renders an accessible error notice if local storage cannot be opened.

#### Database schema

- Database: StudyLensDB
- Schema version: 6
- Object stores:
  - `resources`, keyed by the immutable Resource id (non-unique indexes: type, createdAt, updatedAt, and status)
  - `processedContent`, keyed by UUID id (unique index: resourceId)
  - `learningOutputs`, keyed by UUID id (indexes: resourceId, type, createdAt, and sourceChunkIds with multiEntry: true)
  - `quizzes`, keyed by UUID id (indexes: resourceId, createdAt)
  - `quizAttempts`, keyed by UUID id (indexes: quizId, resourceId, completedAt, createdAt)
  - `notes`, keyed by UUID id (indexes: resourceId, updatedAt, createdAt)

The indexes support resource-type views, processing queues, chronological listings, recent-resource sorting, instant lookup/replacement of processed content by resourceId, querying learning outputs by resource, type, creation date, or source chunk, fast retrieval/cleanup of quizzes by parent resourceId, efficient chronological filtering and lookup of quiz attempt histories by quiz or parent resource, and fast retrieval/cleanup and chronological sorting of user notes.

### Storage modules

- js/storage/databaseSchema.js owns database constants, store creation, indexes, and upgrade steps.
- js/storage/indexedDB.js owns a cached, version-aware database connection and database availability errors.
- js/storage/resourceValidation.js owns resource creation, UUID generation, field validation, and immutable-field checks.
- js/storage/resourceStore.js exposes the Resource repository API and converts native requests into clean promises.
- js/storage/processedContentStore.js exposes the ProcessedContent repository API for durable processed content storage.
- js/storage/learningOutputValidation.js owns learning output validation, UUID generation, and immutable-field checks.
- js/storage/learningOutputStore.js exposes LearningOutputRepository for durable study aids storage.

### Migration strategy

Schema changes increment DATABASE_VERSION and add a version-specific migration in upgradeDatabaseSchema. Version 2 introduced the `processedContent` store with a unique `resourceId` index. Version 3 introduced the `learningOutputs` store with `resourceId`, `type`, `createdAt`, and multi-entry `sourceChunkIds` indexes while preserving all existing data.

### Resource model

Resource records contain id, title, type, source, content, createdAt, updatedAt, status, tags, and metadata. IDs are generated with crypto.randomUUID when a record is created. The id and createdAt fields cannot be changed by updates; updatedAt is refreshed automatically.

Manually entered text uses source manual://text-entry, status completed, and metadata entryMethod: manual. This means the text is ready to read, not that an AI or extraction pipeline was run.

## Current limitations

Only manually entered text resources can be created in the UI. Text resources have an end-to-end processing foundation with persistent storage, retrieval, and deterministic learning output generation (extractive summaries, key concepts, definitions, and questions). All generation is pure, client-side, and deterministic—no external AI or LLM API is used. Basic search, filtering (by type, status, and tag), and sorting are available in the Library, but advanced search (fuzzy, semantic, AI-powered) is planned for V3. PDF, image, and video adapters; parsing; OCR; notes; flashcards; quizzes; analytics; and AI capabilities remain later work.

## Library search and filtering (Day 5)

js/algorithms/librarySearch.js owns a pure, testable search, filter, and sort pipeline. It performs local exact substring matching across title, content, and tags. The pipeline order is search, type filter, status filter, tag filter, then sort.

The Library controls in the HTML toolbar fire change and input events. js/features/resourceList.js reads the current control values, calls applyLibraryFilters, and re-renders only the Library section. Dashboard recent resources always show the three newest, unfiltered.

After resource create, edit, or delete, the Library reloads from ResourceRepository and reapplies the active filter state. Search and filter state is local to the Library view and is not persisted.

This is not fuzzy, semantic, or AI-powered search. It does not use fuzzy matching, embeddings, semantic search, or external services. Advanced search capabilities are planned for V3.

## Tag system and resource organization (Day 6)

js/utils/tagUtils.js centralizes all tag normalization, validation, and collection logic. Tags are lowercased, trimmed, deduplicated, and validated against configurable limits (20 tags max, 50 characters each).

The Library pipeline now includes a tag filter stage: search, type filter, status filter, tag filter, then sort. The tag filter dropdown is populated dynamically from the actual tags present in stored resources using collectAllTags. Tag options update automatically after resource create, edit, or delete.

The resource viewer now displays updated timestamps and source information when available, clearly distinguishing core, organization, timing, and source metadata.

No IndexedDB schema changes were needed. Tags are stored as part of the existing Resource model.

## Content processing foundation (Day 7)

Day 7 introduces a separate, pure processing boundary. It works with a validated Resource snapshot and does not talk to the UI or IndexedDB:

    Feature or future workflow
      ↓
    ContentProcessingPipeline
      ↓
    Source adapter
      ↓
    Normalizer and paragraph-aware chunker
      ↓
    In-memory NormalizedContent

- js/processing/contentProcessingPipeline.js validates a Resource, selects an adapter, and coordinates extraction, normalization, and chunking.
- js/processing/textAdapter.js is the only implemented adapter. It handles Resource type text and never mutates the input Resource.
- js/processing/textNormalizer.js converts CRLF and CR line endings to LF, compacts horizontal whitespace, reduces excess blank lines to one paragraph break, and trims document and paragraph edges.
- js/processing/contentChunker.js creates ordered, contiguous segments. It prefers paragraph boundaries, then line boundaries, then uses a deterministic hard split to meet a configurable maxChunkSize (1,200 characters by default).
- js/processing/errors.js exposes meaningful ContentProcessingError codes without coupling processing errors to storage errors.

The plain-object adapter contract is id, canHandle(resource), extract(resource), and normalize(extractedContent, resource). Future adapters can implement this contract without a class hierarchy or changes to the pipeline.

NormalizedContent contains resourceId, sourceType, text, segments, createdAt, and metadata. Each segment contains index, startOffset, endOffset, and text. createdAt represents the Resource updatedAt snapshot used to derive the result, which keeps processing output deterministic.

## Processing integration and persistence (Day 8)

Day 8 connects the Day 7 content-processing pipeline to persistent storage and the existing Text Resource workflow:

    Text Resource Input
      ↓
    Resource (saved to resources store)
      ↓
    TextAdapter (extracts plain text content)
      ↓
    Normalization (deterministic whitespace & line ending cleanup)
      ↓
    Chunking (ordered, contiguous segments with character offsets)
      ↓
    Processed Content (NormalizedContent snapshot)
      ↓
    Persistent Storage (ProcessedContentRepository in processedContent store)
      ↓
    Reader / Viewer (retrieval and lightweight chunk count indication)

- js/storage/processedContentStore.js implements ProcessedContentRepository for the `processedContent` store in StudyLensDB (schema version 2). Records contain id, resourceId, normalizedText, chunks, sourceType, metadata, createdAt, and updatedAt.
- js/features/processingIntegration.js provides the service boundary: `processAndStore(resource)`, `processResourceById(id)`, `getProcessedContent(id)`, and `deleteProcessedContent(id)`.
- Reprocessing on edit: When a text resource is updated, stale processed content is invalidated/removed, the resource is reprocessed, and the new result is persisted. The original resource id and createdAt are preserved; updatedAt is refreshed. Old processed versions are never silently returned.
- Processing lifecycle & errors: The original user text remains intact. If processing fails, the original resource is preserved, its status is marked as `failed` with failure details in metadata, and stale processed data is not returned.
- Viewer integration: The resource reader retrieves processed content via `getProcessedContent(id)` and displays a lightweight badge indicator (e.g. `X chunks processed`). When a resource is deleted, related processed content is automatically cleaned up.
- Library integration: Library search, type/status/tag filtering, and sorting continue to function seamlessly.

## Learning output foundation (Day 9)

Day 9 establishes the persistence foundation for study aids and learning outputs, decoupling generation from storage:

    Processed Content
      ↓
    Learning Output Foundation
      ↓
    StudyLensDB v3 (learningOutputs store)

- js/storage/learningOutputValidation.js validates `LearningOutput` records: id, resourceId, type ('summary' | 'concept' | 'definition' | 'question' | 'flashcard' | 'quiz'), content (string or structured object), sourceChunkIds (array of string or number chunk identifiers), metadata, createdAt, and updatedAt.
- js/storage/learningOutputStore.js implements `LearningOutputRepository` for the `learningOutputs` object store in StudyLensDB (schema version 3). Indexes include `resourceId`, `type`, `createdAt`, and `sourceChunkIds` (multiEntry).
- Traceability: Mandatory `sourceChunkIds` on all learning outputs maintain explicit linkages back to the processed chunks from which they were derived.

## Deterministic learning output engine (Day 10)

Day 10 implements an automated, deterministic learning output engine that extracts study aids without AI:

    Processed Content (NormalizedContent snapshot)
      ↓
    Content Analysis (stopwords, sentence segmentation, frequency scoring, definition pattern detection, question generation, extractive summary)
      ↓
    Learning Output Generator (generateLearningOutputs)
      ↓
    Learning Output Service (generateLearningOutputsForResource, getLearningOutputsSummaryForResource, clearLearningOutputsForResource)
      ↓
    Learning Outputs (persisted in learningOutputs store via LearningOutputRepository)
      ↓
    Resource Viewer (summary counts and on-demand "Generate learning outputs" trigger)

### Content analysis algorithms

- js/processing/stopwords.js provides a standard list of English stopwords used to filter common words during concept scoring.
- js/processing/contentAnalysis.js provides pure, deterministic analysis functions:
  - Sentence segmentation (`splitSentences`): Splits text on sentence boundaries (`. `, `! `, `? `, `\n\n`) while tracking source character offsets.
  - Chunk mapping (`findOverlappingChunkIds`): Determines which chunk IDs overlap a given text span based on character offsets.
  - Concept extraction (`extractKeyConcepts`): Identifies meaningful single words and multi-word terms using term frequency, capitalized title hints, and stopword exclusion. Scores reflect term prominence without claiming "AI confidence".
  - Definition extraction (`extractDefinitions`): Recognizes clear syntactic patterns such as "X is Y", "X refers to Y", "X means Y", and "X is defined as Y".
  - Question generation (`generateQuestions`): Synthesizes grounded questions directly from extracted definitions and concepts ("What is X?", "What does X mean?", "How does X work?", "Why is X important?").
  - Extractive summarization (`generateExtractiveSummary`): Selects prominent sentences based on concept density and position while strictly preserving source text and order.

### Learning output generation & service orchestration

- js/processing/learningOutputGenerator.js converts content analysis outputs into validated `LearningOutput` records.
  - Supported Day 10 types: `summary`, `concept`, `definition`, `question`.
  - Deferred types: `flashcard` and `quiz` (planned for future milestones).
  - Every output record includes `sourceChunkIds` for end-to-end traceability.
- js/features/learningOutputService.js orchestrates generation, retrieval, and cleanup:
  - `generateLearningOutputsForResource(resourceId)`: Retrieves processed content, analyzes text, generates outputs, removes previous outputs for the resource to prevent duplicates, and persists new outputs.
  - `getLearningOutputsSummaryForResource(resourceId)`: Returns aggregated counts and summary status.
  - `clearLearningOutputsForResource(resourceId)`: Deletes all outputs for a resource.
  - Automatic cleanup: Resource deletion automatically deletes associated learning outputs.
- UI integration: The Resource Viewer includes an on-demand "Generate learning outputs" button and displays a lightweight summary of generated items (summary status, concepts, definitions, questions).
- Deterministic guarantee: Zero external AI APIs, LLMs, or external NLP libraries are used. All generation is pure, client-side, and reproducible.

## Learning outputs reader UI (Day 11)

- js/features/learningOutputView.js renders categorized study aids into the Resource Viewer modal using textContent only.
- Source traceability badges format chunk indices into human-friendly grounded labels (e.g. `Chunk 1`, `Chunks 1, 2`).
- Handles empty, loading (spinner), and error states directly in the modal.
- Concurrency guard in js/features/resourceViewer.js prevents duplicate generation requests.
- Dialog scrolling (`max-height: calc(100dvh - 2.5rem); overflow-y: auto`) prevents viewport overflow on long content.

## Interactive flashcards feature (Day 12)

Day 12 introduces the first complete active recall study feature for StudyLens:

    Processed Content
      ↓
    Learning Outputs (Definitions, Questions, Concepts)
      ↓
    Flashcard Generator (js/processing/flashcardGenerator.js)
      ↓
    Flashcard Service (js/features/flashcardService.js)
      ↓
    StudyLensDB v3 (learningOutputs store, type: 'flashcard')
      ↓
    Flashcards Page (js/features/flashcardPage.js) & Flashcard Viewer (js/features/flashcardViewer.js)

### Generation without fabrication
- Pure, deterministic conversion of existing verified study aids into `{ front, back }` cards:
  - Definitions → `front: term`, `back: definition`
  - Questions → `front: question`, `back: "Review concept: {relatedTerm}"` (grounded factual referral, no invented answers)
  - Concepts → `front: "What is {term}?"`, `back: "Key concept identified in this resource."`
- Every generated flashcard strictly preserves `sourceChunkIds` for end-to-end source traceability.
- Generator interface is clean and isolated for seamless future AI replacement.

### Storage & service
- Flashcards are stored as `LearningOutput` records with `type: 'flashcard'` and structured `{ front, back }` content in the existing `learningOutputs` store. No schema version bump or migration was needed.
- `js/features/flashcardService.js` orchestrates generation, persistence, deduplication on regeneration (clearing old flashcards before inserting new ones), deck grouping by resource, and deletion.

### User experience
- **Resource Viewer**: Includes a dedicated "Generate flashcards" / "Regenerate flashcards" button, real-time flashcard count in the summary indicator, and a flashcard preview section with a direct "Study deck" launcher.
- **Flashcards Page**: Replaces the static placeholder with an active deck collection page (#flashcards) showing deck cards grouped by source resource, card count badges, previews, and "Study deck" buttons.
- **Flashcard Study Viewer**: Native dialog with 3D CSS card flip, Next/Previous card navigation, "Card X of Y" progress counter, animated completion bar, source chunk traceability badge, and full keyboard interaction (<kbd>Space</kbd>/<kbd>Enter</kbd> to flip, <kbd>←</kbd> and <kbd>→</kbd> to navigate, <kbd>Escape</kbd> to close).
- **Dashboard**: Live flashcard stat counter wired to storage and reactively updated via `learningoutputschanged` events.
- **Safe rendering**: All dynamic text content is inserted via `textContent`; zero `innerHTML` or `eval`.

## Interactive Quiz System (Day 13)

Day 13 introduces the complete local Quiz System with deterministic multiple-choice question generation, persistence, collection deck management, and interactive modal quiz play:

    Processed Content
      ↓
    Learning Outputs (Definitions, Concepts, Questions)
      ↓
    Quiz Generator (js/processing/quizGenerator.js)
      ↓
    Quiz Service (js/features/quizService.js)
      ↓
    StudyLensDB v4 (quizzes store via QuizRepository)
      ↓
    Quizzes Page (js/features/quizPage.js) & Quiz Player (js/features/quizPlayer.js)

### Deterministic MCQ Generation & Authentic Distractors
- Pure client-side generation without external AI/LLM APIs, external NLP, vector DBs, or hallucinated content:
  - **Strategy 1 (Definition → Meaning)**: `"What is the definition of {term}?"` with correct answer as definition and distractors drawn from authentic definitions of other terms in the same resource.
  - **Strategy 2 (Meaning → Term)**: `"Which term refers to: '{definition}'?"` with correct answer as term and distractors drawn from authentic terms and key concepts in the same resource.
  - **Strategy 3 (Grounded Questions Pool)**: Matches generated questions with known definitions to produce targeted review MCQs.
- **Authentic Distractors**: Distractors are exclusively selected from verified sibling terms/definitions within the same source resource, preventing fabrication or nonsense distractors.
- **Deterministic Shuffle**: Distractor order is pseudorandomly shuffled using a deterministic hash seed based on question text and index, guaranteeing identical results for identical content.
- **Source Traceability**: Every question retains its `sourceChunkIds` array, allowing users to trace quiz questions directly back to original resource chunks.

### Storage & Data Model (StudyLensDB v4)
- Upgraded StudyLensDB from schema version 3 to 4, adding the dedicated `quizzes` object store with non-unique indexes on `resourceId` and `createdAt`.
- Validated `Quiz` and `QuizQuestion` schemas in `js/storage/quizValidation.js` with immutable `id`, `resourceId`, and `createdAt` guarantees.
- `QuizRepository` (`js/storage/quizStore.js`) implements full CRUD operations, index lookups by resource, and clear/count methods adhering to the repository pattern.

### Service Orchestration & Duplicate Safety
- `js/features/quizService.js` coordinates generation, persistence, and queries:
  - Automatically ensures learning outputs exist for the resource before generating a quiz.
  - **Regeneration duplicate safety**: Deletes any existing quiz for the resource prior to inserting the newly generated quiz, preventing record accumulation.
  - **Cascading deletion**: When a resource is deleted in `resourceViewer.js`, its associated quiz is automatically purged from `quizzes`.
  - Dispatches `quizzeschanged` events on `resourceEvents.js` to notify interested views reactively.

### User Experience & Interactive Quiz Player
- **Resource Viewer**: Features a "Generate quiz" / "Regenerate quiz" action button with concurrency guard, quiz preview card showing question count and previews, and a direct "Take quiz" launcher.
- **Quizzes Page (`#quizzes`)**: Replaces the static placeholder with an active quiz deck collection view showing responsive cards with title, question count badge, first question preview, and "Take quiz" button.
- **Interactive Quiz Player (`#quiz-player-dialog`)**:
  - Displays one question at a time with clear, accessible option buttons and letter badges (A, B, C, D).
  - Navigation controls (Previous and Next) preserving temporary answer selections in memory without saving partial attempts.
  - Live progress counter ("Question X of Y") and progress bar.
  - On the final question, displays "Submit quiz".
  - **Scoring & Breakdown**: Calculates score (`X / Y Correct (Z%)`) and renders a full question-by-question breakdown with Correct (green) and Incorrect (rose) badges, showing selected vs correct answers.
  - **Retry Quiz**: Clears memory answers and resets to question 1 without mutating the stored quiz definition.
- **Dashboard**: Live Quizzes stat card wired to `countQuizzes()` and reactively refreshed via `quizzeschanged`.
- **Safe Rendering**: All dynamic user and generated text is strictly inserted via `textContent`, completely preventing XSS injection.

## Quiz Attempt Results & Basic Analytics (Day 14)

Day 14 establishes persistent quiz attempt history and client-side performance analytics without external services, backend servers, or cloud databases:

    Quiz Player Submission
      ↓
    Deterministic Result Calculation (js/processing/quizScoreCalculator.js)
      ↓
    Quiz Attempt Service (js/features/quizAttemptService.js)
      ↓
    StudyLensDB v5 (quizAttempts store via QuizAttemptRepository)
      ↓
    Analytics Service (js/features/analyticsService.js)
      ↓
    Quiz Player Results / History Modal & Quiz Analytics Page (#analytics)

### Deterministic Score Calculation
- `calculateQuizResult(quiz, userAnswers)` in `js/processing/quizScoreCalculator.js`:
  - Evaluates user answers against quiz definition questions purely in memory.
  - Accounts for correct, incorrect, and unanswered questions cleanly.
  - Computes score (number of correct questions), percentage (0-100 rounded), and total count.
  - Generates full `QuestionResult` items with `selectedAnswer`, `correctAnswer`, `isCorrect`, `isUnanswered`, and preserved `sourceChunkIds`.

### Storage & Data Model (StudyLensDB v5)
- Upgraded StudyLensDB from version 4 to 5, adding the dedicated `quizAttempts` object store with indexes on `quizId`, `resourceId`, `completedAt`, and `createdAt`.
- Validated `QuizAttempt` and `QuestionResult` schemas in `js/storage/quizAttemptValidation.js`.
- `QuizAttemptRepository` (`js/storage/quizAttemptStore.js`) provides persistent CRUD, indexed lookups by quiz and resource (sorted newest first), and deletion/clear methods.
- **Independence of Quiz Definition vs Attempts**: Quizzes in the `quizzes` store remain immutable study templates. User attempts in `quizAttempts` are independent historical records. When a quiz is regenerated, existing attempts remain preserved.
- **Cascading Deletion**: When a resource is deleted, `deleteAttemptsForResource` automatically cleans up all associated attempts.

### Analytics Service
- `computeQuizAnalytics(attempts, options)` in `js/features/analyticsService.js`:
  - Derives aggregate metrics purely from stored attempts: `totalAttempts`, `uniqueQuizzesCount` / `totalQuizzesTaken`, `averageScorePercentage` / `averageScore`, `highestScorePercentage` / `highestScore`, and `recentActivity` / `recentAttempts`.
  - Zero attempts produces an honest empty state with 0s across all metrics.

### User Experience
- **Results Screen**: In `js/features/quizPlayer.js`, displays score banner, stat chips (Correct, Incorrect, Unanswered count badges), per-question review with answer details and source grounding badges, and a "View attempt history" button.
- **Attempt History Modal**: Lists past attempts with date, score %, performance summary, and a "Review" button allowing users to inspect past submission breakdowns.
- **Safe Retry**: Resets player answers and session in memory; does NOT record empty or partial attempts until the user explicitly re-submits.
- **Quizzes Page**: Added a direct "History" button on quiz cards to launch the player directly into history mode.
- **Quiz Analytics Page (`#analytics`)**: Real-time stats grid, recent activity feed with "Retake" shortcuts, empty state guidance, and reactive sync with storage events.

## Notes Workspace (Day 15)

Day 15 establishes the persistent, standalone and resource-linked Notes Workspace in StudyLens without backend services, external frameworks, cloud storage, or AI/LLM APIs:

    UI (Notes Page #notes & Resource Viewer)
      ↓
    Note Editor Modal (#note-editor-dialog)
      ↓
    Note Service (js/features/noteService.js)
      ↓
    StudyLensDB v6 (notes store via NoteRepository in js/storage/noteStore.js)
      ↓
    Reactive Events (js/core/resourceEvents.js: noteschanged)

### Storage & Data Model (StudyLensDB v6)
- Upgraded StudyLensDB from version 5 to 6, adding the dedicated `notes` object store with indexes on `resourceId`, `updatedAt`, and `createdAt`.
- Validated `Note` schema in `js/storage/noteValidation.js`:
  - `id`: unique UUID string (immutable).
  - `resourceId`: nullable string (links note to a Resource, or `null` for standalone notes).
  - `title`: non-empty string, max 200 characters.
  - `content`: non-empty plain/lightweight structured string, max 100,000 characters.
  - `tags`: array of normalized lowercase tag strings.
  - `metadata`: extensible object.
  - `createdAt`: ISO 8601 timestamp (immutable).
  - `updatedAt`: ISO 8601 timestamp (updated on edit).
- `NoteRepository` (`js/storage/noteStore.js`) provides persistent CRUD, indexed lookups by resource and global listing (sorted by `updatedAt` descending), and cascading cleanup.

### Note Service
- `js/features/noteService.js` coordinates:
  - CRUD operations (`createNote`, `getNote`, `getAllNotes`, `getNotesByResource`, `updateNote`, `deleteNote`, `deleteNotesForResource`, `countNotes`).
  - Event notifications (`notifyNotesChanged` emitting `noteschanged`).
  - Pure, deterministic local substring search (`searchNotes`) across normalized title, content, and tags.
  - Resource-based filtering (`filterNotesByResource`) supporting `all`, `standalone` (`resourceId === null`), or specific `resourceId`.
  - Composed pipeline (`filterAndSearchNotes`).

### User Experience
- **Notes Workspace (`#notes`)**:
  - Responsive 3-column grid (`.notes-grid`) collapsing to 2 columns on tablet and 1 column on mobile.
  - Search toolbar with real-time text input (`[data-notes-search]`), resource filter dropdown (`[data-notes-resource-filter]`), and clear button.
  - Note cards with title, linked resource badge (if linked), preview text, tag list, formatted update date, and edit/delete actions.
  - Empty states for both initial zero-note state and zero-match search/filter state.
- **Note Editor Dialog (`#note-editor-dialog`)**:
  - Supports creating standalone notes or linking notes to any library resource via dynamically loaded resource dropdown.
  - Supports editing existing notes, preserving immutable `id` and `createdAt` while updating `updatedAt`.
  - Client-side validation for title and content, displaying clear error alerts.
  - Explicit save action on form submit (no keystroke autosave).
  - Delete Note confirmation dialog (`#delete-note-dialog`) preventing accidental deletion.
- **Resource Viewer Integration**:
  - "Add note" action button in `#resource-viewer-dialog` footer pre-populates note title (`Notes — {title}`), resource link, and tags.
  - Cascading deletion: deleting a parent resource automatically deletes all its associated notes.
- **Dashboard Stat Counter**:
  - Live Notes counter (`<strong data-stat="notes">`) updated on app startup and reactively synchronized via `onNotesChanged`.
- **Strict Safe Rendering**:
  - All user content rendered strictly via `textContent`, with zero HTML interpretation and verified XSS attack prevention.



