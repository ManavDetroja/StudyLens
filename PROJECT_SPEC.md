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

## Library search and controls (Day 5)

The Library supports basic local text search across resource title, content, and tags. Resources can be filtered by type and status, and sorted by creation date, update date, or title. The search is case-insensitive and substring-based. Filter combinations are applied in sequence: search, type, status, sort.

Result counts and distinct empty states help the user understand whether the library is empty or whether filters are narrowing results to zero. A clear-filters control resets all active filters.

This is not fuzzy, semantic, or AI-powered search.

## Resource organization and tags (Day 6)

Tag handling is centralized in js/utils/tagUtils.js. Tags are normalized to lowercase, trimmed, and deduplicated. Validation enforces a maximum of 20 tags per resource and 50 characters per tag.

The Library supports tag-based filtering through a dynamically populated dropdown. The filter pipeline order is search, type, status, tag, then sort. Tag matching is exact and case-insensitive.

The resource viewer displays updated timestamps and source metadata when applicable. No IndexedDB schema changes were introduced.

## Content processing foundation (Day 7)

StudyLens now has a local, in-memory processing pipeline for valid Resource snapshots. The only implemented source adapter is TextAdapter for existing text resources. It extracts the existing content string, normalizes line endings and whitespace deterministically, and splits the normalized result into ordered, paragraph-aware text segments.

The foundation is intentionally callable through the processing module without external dependencies. PDF, image, video, OCR, file parsing, transcript extraction, and AI features remain unimplemented.

## Processing integration and persistence (Day 8)

The content-processing pipeline is now connected end-to-end with the Text Resource workflow. StudyLensDB is upgraded to schema version 2, introducing the `processedContent` object store with a unique `resourceId` index.

The processing pipeline sequence is:
Resource → Source Adapter (TextAdapter) → Normalization → Chunking → Processed Content → IndexedDB (`processedContent` store).

When a text resource is created or edited:
- The resource is stored in the `resources` store, keeping the original user text intact.
- The content is processed into normalized text and ordered, contiguous chunks with character offsets.
- On edit, stale processed content is removed before the newly processed snapshot is saved. Original resource id and createdAt are preserved; updatedAt is refreshed.
- The resource viewer displays a lightweight indicator of processed chunks.
- If processing fails, the original resource is kept, its status is marked as `failed`, and failure details are stored in metadata.
- Deleting a resource also cleans up associated processed content.

Only TextAdapter is implemented. PDF, image/OCR, video/transcript, and AI generation remain planned future milestones.

## Learning output foundation (Day 9)

StudyLensDB is upgraded to schema version 3, adding the `learningOutputs` object store with indexes on `resourceId`, `type`, `createdAt`, and `sourceChunkIds` (multiEntry).

The `LearningOutput` data model establishes a standardized schema for study aids:
- Fields: `id`, `resourceId`, `type`, `content`, `sourceChunkIds`, `metadata`, `createdAt`, `updatedAt`.
- Supported types: `summary`, `concept`, `definition`, `question`, `flashcard`, and `quiz`.
- Mandatory chunk traceability via `sourceChunkIds`.
- Persistence managed through `LearningOutputRepository`.

## Deterministic learning output engine (Day 10)

Day 10 introduces the deterministic learning output engine that automatically produces study aids without AI:
Processed Content → Content Analysis → Learning Output Generator → Learning Outputs.

- **Content Analysis**:
  - Deterministic sentence segmentation and character offset mapping to chunks.
  - Frequency scoring with stopword filtering for key concepts (unigrams and multi-word terms).
  - Obvious pattern matching for definitions ("X is Y", "X refers to Y", "X means Y", "X is defined as Y").
  - Grounded question generation based on extracted concepts and definitions.
  - Extractive summarization selecting salient sentences while strictly preserving source wording and order.
- **Output Types Generated in Day 10**:
  - `summary`: extractive overview with original wording.
  - `concept`: key terms with deterministic frequency scores.
  - `definition`: term and definition pairs matching syntactic patterns.
  - `question`: study questions grounded in source content.
  - Note: `flashcard` and `quiz` generation remain deferred.
- **Source Traceability**: Every generated output references the chunk IDs (`sourceChunkIds`) where the information originated.
- **Regeneration**: Running generation again replaces previous outputs for the resource, preventing duplicate or stale records.
- **User Interface**: The Resource Viewer contains an on-demand "Generate learning outputs" button and shows an outputs summary badge.
- **Pure Client-Side**: No external AI APIs, LLMs, API keys, or external NLP libraries are used.
