# StudyLens

StudyLens is a client-side learning workspace that will eventually turn source material into structured study aids. Day 8 integrates the text-only content processing pipeline with the Text Resource workflow, persists normalized and chunked content in IndexedDB (StudyLensDB v2), supports automatic reprocessing on edit, and displays processed status in the resource reader.

## Run locally

Serve the repository root with any local static HTTP server, then open its local address in a modern browser. No installation, build step, backend, or external framework is required. Serving over HTTP gives IndexedDB a stable browser origin for manual testing.

Run the Node checks with:

    node --test tests/routes.test.mjs tests/resourceValidation.test.mjs tests/tagUtils.test.mjs tests/textResourceInput.test.mjs tests/resourceViewer.test.mjs tests/librarySearch.test.mjs tests/textNormalizer.test.mjs tests/contentChunker.test.mjs tests/textAdapter.test.mjs tests/contentProcessingPipeline.test.mjs tests/processingIntegration.test.mjs tests/storage.browser.test.mjs

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
- Clean deletion cleanup: removing a resource also cleans up its associated processed content.

## Project layout

    css/             Design tokens, layout, components, and responsive rules
    js/core/         Route metadata and future shared application primitives
    js/ui/           Navigation and modal UI behaviours
    js/features/     Feature-level UI placeholders and processing integration
    js/storage/      Versioned IndexedDB connection, schema, validation, resource store, and processed store
    js/processing/   Local source adapters, normalization, chunking, and pipeline
    tests/           Node checks and a self-cleaning native-browser storage suite
    ts/              Minimal domain types for future storage and processing

See ARCHITECTURE.md for navigation and responsive-design decisions, and TASKS.md for planned work.

## Current limitations

Only manual text resources are available in the UI. PDF, image, and video adapters, import, extraction, OCR, AI, notes, flashcards, quizzes, analytics, authentication, and backend services remain intentionally out of scope.
