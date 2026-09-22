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
- Next: Source adapters for non-text material (e.g., PDF upload and metadata) or initial study aid generation.

## V2 — Content processing

- Source adapters for video URLs, PDF files, and image/OCR.
- AI provider integration and generation of learning outputs.

## V3 — Learning intelligence

- Searchable knowledge library.
- Flashcard review and quiz experiences.
- Analytics, spaced repetition, and knowledge-graph capabilities.

Only the Day 8 text-processing pipeline and persistent storage are implemented now. Additional V2 and all V3 items are plans, not active features.
