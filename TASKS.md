# Task backlog

## Completed — Day 1 through Day 8

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

## Next

- [ ] Add source adapters for non-text material (e.g. PDF upload and metadata) or initial study aid generation.

## Explicitly deferred

No PDF, image, or video extraction; OCR; PDF parsing; video transcripts; AI integration; search algorithms; flashcard algorithms; quizzes; analytics calculations; authentication; or backend has been implemented. Only manually entered text has an active adapter and end-to-end processing pipeline today.
