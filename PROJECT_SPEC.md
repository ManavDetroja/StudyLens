# Project Specification

**Goal**: Turn learning materials into AI-generated study aids.

## Inputs
- Video URLs (future)
- PDF files (local file import and browser-based text extraction available; OCR for scanned PDFs in future phase)
- Image files (local file import foundation available; OCR in future phase)
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

## Local file import foundation (Day 16)

Day 16 establishes client-side ingestion and persistent storage of local PDF and image files without external servers, APIs, or content extraction:
- **Scope & Boundary**: Ingestion and local persistence foundation only. No PDF text parsing, no OCR, and no AI processing are performed in Day 16.
- **Storage Architecture (StudyLensDB v7)**:
  - Database schema upgraded to version 7.
  - Dedicated `fileBlobs` object store keyed by `resourceId`.
  - Stored records contain `resourceId`, binary `blob` (as native `Blob`/`File`), `mimeType`, `size`, and `savedAt`.
  - Keeps binary payloads isolated from resource listing metadata to prevent query degradation.
- **Resource Model Integration**:
  - Reuses the existing `Resource` model with `type: 'pdf'` or `type: 'image'`.
  - `status: 'pending'` (accurately reflecting that content extraction has not run yet).
  - `content: null`.
  - `metadata`: `entryMethod: 'file-import'`, `originalFileName`, `mimeType`, `fileSize`, `extension`.
- **Validation**:
  - Maximum file size: 50 MB (configurable via `FILE_IMPORT_CONFIG`).
  - Supported MIME types: `application/pdf`, `image/jpeg`, `image/jpg`, `image/png`, `image/webp`.
  - Extension fallbacks for operating systems that omit MIME types.
  - Non-empty files enforced; sanitization for filenames.
- **User Interface**:
  - File import dialog (`#file-import-dialog`) with file picker, format helper, live metadata preview, default derived title, and tags editor.
  - Dashboard quick actions for PDF and Image wired directly to file import dialog.
  - Resource Viewer (`#resource-viewer-dialog`) displays file details card (name, format, size, MIME type, pending status), hides text edit button, disables output generation, and provides image thumbnail previews for image resources with safe object URL lifecycle management.
  - Cascading delete: deleting a file resource purges its entry from `fileBlobs`.

## Browser-based PDF text extraction (Day 17)

Day 17 implements client-side, offline selectable-text extraction for local PDF resources:
- **Scope & Boundary**: Selectable text extraction only. Scanned or image-only documents requiring OCR are explicitly deferred. No remote CDNs, backend parsing services, or external AI/LLM APIs.
- **Vendored PDF Engine**:
  - PDF.js (v3.11.174 legacy build) vendored directly into `js/vendor/pdf/`.
  - Universal loader (`js/processing/pdfParserLoader.js`) loads the library and configures worker source in browser and Node environments.
- **Extraction & Normalization**:
  - `extractPdfText`: reads binary PDF data from `fileBlobs`, traverses document page-by-page, extracts text items, and preserves 1-based page numbering and boundaries.
  - Validation guards: throws `PDF_DATA_MISSING`, `INVALID_PDF_DATA`, `EMPTY_PDF`, `INVALID_PDF`, and `NO_SELECTABLE_TEXT`.
  - PDF Source Adapter (`js/processing/pdfAdapter.js`): conforms to `SourceAdapter` contract, connects to `fileBlobStore`, applies deterministic text normalization (`normalizeTextContent`), and records character offset ranges for each page (`pageOffsets`).
- **Content Pipeline & Traceability**:
  - Integrates with `contentProcessingPipeline.js`.
  - Enriches segmented chunks with `pageNumber` (first overlapping page) and `pages` (array of all overlapping pages) via `enrichSegmentsWithPages` for page-level source traceability.
- **Resource Lifecycle**:
  - Resource status transitions: `pending` → `processing` → `completed` (or `failed` with error metadata).
  - Extracted normalized text is stored on the resource record (`content: normalizedContent.text`) and segmented chunks are persisted into the `processedContent` store.
- **User Interface**:
  - Resource Viewer provides "Extract PDF content" button with in-place loading feedback ("Extracting…") and toggling to "Reprocess PDF" when completed.
  - Page-based rendering formats text with page headers (`--- Page X ---`).
  - Color-coded status badges for `pending`, `processing`, `completed`, and `failed`.
  - Graceful handling for non-selectable PDFs with clear user messaging ("No selectable text was found in this PDF. OCR will be supported in a future milestone.").
- **Downstream Integration**:
  - Extracted PDF content seamlessly powers Day 10 Learning Outputs (Extractive Summary, Key Concepts, Definitions, Questions), Day 12 Flashcards, and Day 13–14 Quizzes.
  - Reprocessing is idempotent: cleans previous chunks without duplicate accumulation.

## Deterministic source-grounded learning output quality (Day 19)

Day 19 improves deterministic source-grounded output quality across all StudyLens study aids without external AI or LLMs. Day 19 improves deterministic source-grounded output quality. It does not introduce an LLM.
- **Evidence Retrieval Layer**: `js/processing/evidenceRetrieval.js` scores and retrieves relevant source sentences for concepts and questions.
- **Placeholder Rejection**: `isGenericPlaceholder` and `validateLearningAnswer` reject generic boilerplate answers (such as `"Key concept identified in this resource"`, `"Review concept: ..."`).
- **Expanded Definitions**: 9 syntactic definition patterns (including `"allows/enables"`, `"occurs when"`, `"represents"`, `"consists of"`).
- **Grounded Flashcards & Quizzes**: Flashcard backs and quiz options are grounded in supporting source evidence with strict `sourceChunkIds` preservation.

## Unified content processing orchestrator (Day 20)

Day 20 unifies content extraction, normalization, chunking, and persistence across all supported source types (Text, PDF, Image) into a cohesive architecture without external AI or LLMs:
- **Source Adapter Registry**: `js/processing/sourceAdapterRegistry.js` provides centralized registration, contract verification, discovery (`findAdapter(resource)`), and clean rejection for unsupported modalities (`UNSUPPORTED_RESOURCE_TYPE`).
- **Image Source Adapter**: `js/processing/imageAdapter.js` conforms to the `SourceAdapter` contract (`id: 'image'`), extracting text from content, metadata, or blob storage with support for pluggable OCR extractors, deterministically normalizing text, and outputting standard normalized content snapshots.
- **Pipeline Decoupling**: `ContentProcessingPipeline` delegates adapter lookup to `SourceAdapterRegistry` while standardizing resource validation, extraction, deterministic text normalization, paragraph-aware chunking, and chunk page/metadata enrichment.
- **Unified Processing Orchestrator**: `js/features/processingIntegration.js` coordinates:
  - Per-resource in-memory concurrency locks (`isResourceProcessing`, `getActiveProcessingIds`) preventing race conditions from duplicate trigger events (`PROCESSING_ALREADY_IN_PROGRESS`).
  - Standardized status lifecycle (`pending` → `processing` → `completed` or `failed`) with failure rollback preserving original resource text and file blobs.
  - Idempotent re-processing: deletes stale processed chunks before saving new chunks, guaranteeing zero duplicate chunk accumulation across repeated runs.
  - Standardized error classification (`classifyProcessingError`) mapping pipeline errors into canonical codes (`UNSUPPORTED_SOURCE`, `EXTRACTION_FAILED`, `NORMALIZATION_FAILED`, `CHUNKING_FAILED`, `PERSISTENCE_FAILED`, `MISSING_SOURCE`, `MISSING_BLOB`).
- **Resource Viewer Controls**: Unified extraction button supporting both PDF and Image resources with live status badges, in-place loading feedback, and friendly error guidance.
- **Downstream Parity**: Extracted content from Text, PDF, and Image flows seamlessly into Day 10 Learning Outputs, Day 12 Flashcards, Day 13–14 Quizzes, and Day 15 linked Notes with strict source chunk traceability (`sourceChunkIds`).

## YouTube video learning resources and transcript ingestion (Day 21)

Day 21 introduces YouTube video learning materials and pure client-side transcript ingestion into the unified content processing architecture without external AI/LLMs or fragile scraping hacks:
- **YouTube URL Validation**: `js/features/youtubeUrlValidator.js` provides deterministic parsing via native `URL` API, extracting canonical 11-char video IDs from standard watch URLs, short links (`youtu.be`), embed links, and shorts while rejecting untrusted domains and malformed inputs.
- **Transcript Parser**: `js/processing/transcriptParser.js` parses timestamps (`MM:SS`, `HH:MM:SS`) into numeric seconds and structured segments (`{ index, text, timestamp, startSeconds, endSeconds }`) from SRT/VTT files, YouTube transcript format, or plain text while retaining clean text for downstream normalization.
- **Transcript Acquisition Provider**: `js/processing/transcriptProvider.js` honestly reports client-side browser CORS restrictions (`TRANSCRIPT_UNAVAILABLE`), preventing fragile scraping hacks and providing clean fallback paths.
- **Video Source Adapter**: `js/processing/videoAdapter.js` conforms to `SourceAdapter` contract (`id: 'video'`) and is registered in `sourceAdapterRegistry`.
- **User Interface**: `#video-resource-dialog` on dashboard and `#paste-transcript-dialog` in resource viewer allow easy video creation and manual transcript pasting.
- **Resource Viewer Integration**: Displays YouTube video details, canonical link, thumbnail preview, CORS notice, and "Process transcript" / "Paste transcript" actions.
- **Downstream Feature Parity**: Processed video transcripts flow seamlessly into Day 10 Learning Outputs, Day 12 Flashcards, Day 13–14 Quizzes, and Day 15 Notes with authentic `sourceChunkIds`.

## Local content processing queue, retry, and recovery system (Day 22)

Day 22 introduces a resilient, in-memory browser-local FIFO processing queue, bounded retry mechanism, stale processing recovery, and data-safe persistence layer for multimodal content processing (Text, PDF, Image, Video) without backend services, server-side queues (no Redis, RabbitMQ, Celery), or external AI/LLMs:
- **Local FIFO Queue Manager**: `js/processing/processingQueue.js` orchestrates job lifecycles (`queued` → `started` → `completed` | `failed` | `cancelled`), limits concurrency to 1 to preserve browser responsiveness, deduplicates concurrent requests, supports re-runs on source modification, and cancels waiting jobs.
- **Pure Error Policy**: `js/processing/processingErrorPolicy.js` categorizes errors into permanent (non-retryable) vs transient (retryable) with human-friendly, stack-free error messages and recovery advice.
- **Pure Display State**: `js/processing/processingDisplay.js` derives unified UI states (`completed`, `processing`, `queued`, `failed`, `stalled`, `idle`) across in-memory jobs and persisted resources.
- **Processing Service Bridge**: `js/features/processingService.js` coordinates `requestProcessing`, `retryProcessing`, `cancelProcessing`, `assertNotProcessing`, and dispatches reactive events via `notifyProcessingChanged`.
- **Stale Processing Recovery**: Automatically sweeps interrupted resources left in `processing` status by closed tabs or crashes (> 60s) into `failed` with retry enabled.
- **Data-Safe Atomic Persistence**: `js/features/processingIntegration.js` preserves previously valid chunks on reprocessing failure, verifies baseline source fingerprints to avoid mid-flight race conditions, and guards against orphan records on deleted resources.
- **UI Integration & Downstream Guard**: Global `#processing-indicator`, Resource Viewer status panel with Retry/Cancel controls, library card status badges and card-level retry, and strict downstream generation blocking during active processing.



