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
