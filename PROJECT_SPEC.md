# Project Specification

**Goal**: Turn learning materials into AI-generated study aids.

## Inputs
- Video URLs (future)
- PDF files (future)
- Image files (future)
- Plain text material (available through manual text entry)

## Planned outputs
- Summaries, notes, flashcards, quizzes (future).

## Constraints
- Pure client-side; no backend.
- Use IndexedDB for persistence.
- Only HTML, CSS, JavaScript (minimal TypeScript).

## Current storage foundation (Day 3)

StudyLens now creates a local IndexedDB database named StudyLensDB at schema version 1. It currently contains one resources store, keyed by a browser-generated UUID. This store accepts metadata records only; Day 3 does not import, read, parse, or process source files.

Each Resource has id, title, type, source, content, createdAt, updatedAt, status, tags, and metadata fields. Supported planned types are video, pdf, image, and text. Planned processing statuses are pending, processing, completed, and failed.

## Text resource workflow (Day 4)

Users can create, read, update, and delete manually entered text resources. The form trims required title and content fields, enforces practical field limits, and turns comma-separated tags into unique clean values. It creates text Resource records through ResourceRepository with a completed status because the user has directly provided normalized text.

Resources remain local to the browser. No PDF, image, video, OCR, source extraction, or AI processing is performed.
