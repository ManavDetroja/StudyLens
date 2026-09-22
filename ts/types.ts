/** Planned learning-material categories supported by the initial storage schema. */
export type ResourceType = 'video' | 'pdf' | 'image' | 'text';

/** Lifecycle states for future extraction and AI processing pipelines. */
export type ResourceStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Extensible, non-sensitive source-specific data. */
export type ResourceMetadata = Record<string, unknown>;

export interface Resource {
    /** Browser-generated UUID. It is immutable after creation. */
    id: string;
    title: string;
    type: ResourceType;
    /** A source identifier such as a URL or a future local-source reference. */
    source: string;
    /** Normalised source content when it becomes available; null while absent. */
    content: string | null;
    /** ISO 8601 timestamps stored as UTC strings. */
    createdAt: string;
    updatedAt: string;
    status: ResourceStatus;
    tags: string[];
    metadata: ResourceMetadata;
}

/** A contiguous, ordered slice of normalized resource text. */
export interface ContentSegment {
    index: number;
    startOffset: number;
    endOffset: number;
    text: string;
}

/** Extensible, non-sensitive adapter metadata for a normalized content snapshot. */
export type NormalizedContentMetadata = Record<string, unknown>;

/**
 * In-memory result of processing one Resource snapshot. It is not persisted in
 * Day 7; later features can choose a versioned storage strategy for it.
 */
export interface NormalizedContent {
    resourceId: string;
    sourceType: ResourceType;
    text: string;
    segments: ContentSegment[];
    /** The Resource updatedAt timestamp represented by this output. */
    createdAt: string;
    metadata: NormalizedContentMetadata;
}

/**
 * Contract for a source-specific adapter. Implementations are plain objects,
 * not a framework or inheritance hierarchy.
 */
export interface SourceAdapter {
    id: string;
    canHandle(resource: Resource): boolean;
    extract(resource: Resource): string | Promise<string>;
    normalize(extractedContent: string, resource: Resource): NormalizedContent | Promise<NormalizedContent>;
}

/**
 * Persisted processed content record in IndexedDB (Day 8).
 * Bridges in-memory NormalizedContent to durable storage with
 * unique resourceId indexing.
 */
export interface ProcessedContent {
    id: string;
    resourceId: string;
    normalizedText: string;
    chunks: ContentSegment[];
    sourceType: ResourceType;
    metadata: NormalizedContentMetadata;
    createdAt: string;
    updatedAt: string;
}
