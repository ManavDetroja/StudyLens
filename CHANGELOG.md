# Changelog

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
