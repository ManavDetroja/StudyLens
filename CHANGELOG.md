# Changelog

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
