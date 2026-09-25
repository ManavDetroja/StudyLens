# Roadmap

## V1 — Foundation

- Day 1: Project scaffold and architecture baseline. Complete.
- Day 2: Responsive application shell, UI system, and placeholder page states. Complete.
- Day 3: Versioned IndexedDB storage, Resource model, repository CRUD API, and tests. Complete.
- Day 4: Text-resource create, read, edit, delete, Dashboard, and Library integration. Complete.
- Day 5: Local Library search, type and status filtering, sorting, result counts, and clear-filters control. Complete.
- Day 6: Centralized tag system, tag-based Library filtering, resource metadata improvements. Complete.
- Day 7: Text-only content-processing foundation: normalization, chunking, adapter contract, pipeline, and tests. Complete.
- Day 8: Processing integration & milestone completion: end-to-end Text Resource processing, StudyLensDB v2 (`processedContent` store), reprocessing on edit, failure handling, viewer indicator, and cleanup. Complete.
- Day 9: Learning Output foundation & persistence: StudyLensDB v3 (`learningOutputs` store), LearningOutput model, validation, repository, and tests. Complete.
- Day 10: Deterministic learning output engine: content analysis, extractive summary, concept extraction, definition extraction, question generation, source chunk traceability, and viewer integration. Complete.
- Day 11: Learning Outputs UI & Experience: complete user experience in Resource Viewer for Summary, Key Concepts, Definitions, and Questions with source traceability, loading states, error states, and safe regeneration. Complete.
- Day 12: Flashcards feature: deterministic generation from definitions, questions, and concepts; persistence in learningOutputs store; deck collection page; and interactive 3D flip-card study viewer with keyboard navigation. Complete.
- Next: Day 13 — Quiz challenge practice views grounded in generated questions/definitions or source adapters for non-text material.

## V2 — Content processing

- Source adapters for video URLs, PDF files, and image/OCR.
- AI provider integration and generation of learning outputs.

## V3 — Learning intelligence

- Searchable knowledge library.
- Quiz practice sessions and spaced repetition review.
- Analytics, spaced repetition, and knowledge-graph capabilities.

Only the Day 12 text-processing pipeline, persistent storage, deterministic learning output engine, structured reader UI, and flashcards study system are implemented now. Additional V2 and all V3 items are plans, not active features.
