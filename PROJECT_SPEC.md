# Project Specification

**Goal**: Turn learning materials into AI-generated study aids.

## Planned inputs
- Video URLs (future)
- PDF files (future)
- Image files (future)
- Plain text material (future)

## Planned outputs
- Summaries, notes, flashcards, quizzes (future).

## Constraints
- Pure client-side; no backend.
- Use IndexedDB for persistence.
- Only HTML, CSS, JavaScript (minimal TypeScript).

## Current storage foundation (Day 3)

StudyLens now creates a local IndexedDB database named StudyLensDB at schema version 1. It currently contains one resources store, keyed by a browser-generated UUID. This store accepts metadata records only; Day 3 does not import, read, parse, or process source files.

Each Resource has id, title, type, source, content, createdAt, updatedAt, status, tags, and metadata fields. Supported planned types are video, pdf, image, and text. Planned processing statuses are pending, processing, completed, and failed.
