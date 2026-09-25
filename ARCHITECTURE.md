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
- Schema version: 3
- Object stores:
  - `resources`, keyed by the immutable Resource id (non-unique indexes: type, createdAt, updatedAt, and status)
  - `processedContent`, keyed by UUID id (unique index: resourceId)
  - `learningOutputs`, keyed by UUID id (indexes: resourceId, type, createdAt, and sourceChunkIds with multiEntry: true)

The indexes support resource-type views, processing queues, chronological listings, recent-resource sorting, instant lookup/replacement of processed content by resourceId, and querying learning outputs by resource, type, creation date, or source chunk.

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
