# StudyLens

StudyLens is a client-side learning workspace that turns source material into structured study aids. Day 11 builds the complete Learning Outputs user experience in the Resource Viewer for extractive summaries, key concepts, definitions, and questions with source chunk traceability, loading states, and safe regeneration in IndexedDB (StudyLensDB v3).

## Run locally

Serve the repository root with any local static HTTP server, then open its local address in a modern browser. No installation, build step, backend, or external framework is required. Serving over HTTP gives IndexedDB a stable browser origin for manual testing.

Run the Node checks with:

    node --test tests/routes.test.mjs tests/resourceValidation.test.mjs tests/tagUtils.test.mjs tests/textResourceInput.test.mjs tests/resourceViewer.test.mjs tests/librarySearch.test.mjs tests/textNormalizer.test.mjs tests/contentChunker.test.mjs tests/textAdapter.test.mjs tests/contentProcessingPipeline.test.mjs tests/processingIntegration.test.mjs tests/learningOutput.test.mjs tests/deterministicLearningOutputs.test.mjs tests/learningOutputView.test.mjs tests/storage.browser.test.mjs

Or run all Node test suites:

    node --test tests/*.test.mjs

Node does not provide native IndexedDB in this project environment, so the storage browser test is reported as skipped there. To run the native IndexedDB CRUD suite, serve the repository root and open tests/storage.browser.html in a modern browser. It uses a uniquely named temporary test database and deletes it after completion.

## Current experience

- Hash-based single-page navigation for Dashboard, Library, Notes, Flashcards, Quizzes, Analytics, and Settings.
- Responsive desktop, tablet, and mobile layout, including an accessible mobile navigation panel.
- Honest empty states, zero-valued dashboard counters, and explanatory feature placeholders.
- Shared CSS patterns for buttons, cards, forms, badges, empty states, modal dialogs, and navigation.
- StudyLensDB initialises when the application starts; the Total Resources card reads the real resources count.
- Storage failures are surfaced in an accessible UI notice instead of being ignored.
- Add Text saves a title, plain-text content, and optional comma-separated tags locally.
- Dashboard recent resources and Library cards refresh after create, edit, or delete.
- A resource reader displays user content as plain text, shows a lightweight processed chunk indicator, and supports editing text resources or confirming their deletion.
- Local Library search across title, content, and tags with type and status filtering, five-option sorting, result counts, and clear-filters controls.
- Centralized tag normalization and validation, dynamic tag-based filtering in the Library, and enhanced resource viewer metadata.
- End-to-end processing for Text Resources: automatically extracts, normalizes, chunks, and persists processed content in IndexedDB (`processedContent` store).
- Automatic reprocessing on resource edit that replaces stale processed data while preserving resource ID and creation date.
- Clean deletion cleanup: removing a resource also cleans up its associated processed content and learning outputs.
- StudyLensDB schema version 3: durable `learningOutputs` store with indexes on `resourceId`, `type`, `createdAt`, and `sourceChunkIds` (multiEntry).
- Deterministic learning output engine: generates extractive summaries, key concepts, pattern-based definitions, and grounded questions without external AI or LLMs.
- Full source traceability: every generated output references originating `sourceChunkIds` linking back to source chunks.
- Resource reader learning experience: complete categorized UI displaying Extractive Summaries, Key Concepts with frequency scores, Definitions with clear term separation, and numbered Study Questions, all with source traceability badges, loading spinners, empty states, and safe deduplicated regeneration.

## Project layout

    css/             Design tokens, layout, components, and responsive rules
    js/core/         Route metadata and future shared application primitives
    js/ui/           Navigation and modal UI behaviours
    js/features/     Feature-level UI logic, processing integration, learning output service, and learning output view
    js/storage/      Versioned IndexedDB connection, schema, validation, resource store, processed store, and learning output store
    js/processing/   Source adapters, normalization, chunking, stopwords, content analysis, and deterministic output generator
    tests/           Node checks and a self-cleaning native-browser storage suite
    ts/              Minimal domain types for storage, processing, and learning outputs

See ARCHITECTURE.md for navigation and responsive-design decisions, and TASKS.md for planned work.

## Current limitations

Only manual text resources and deterministic learning output generation are active today. External AI/LLM integration, flashcard review algorithms, quiz generation, notes, PDF, image, and video adapters, OCR, analytics, authentication, and backend services remain intentionally out of scope.
