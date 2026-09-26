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

/** Supported learning output categories (Day 9 foundation). */
export type LearningOutputType =
    | 'summary'
    | 'notes'
    | 'concept'
    | 'definition'
    | 'question'
    | 'flashcard'
    | 'quiz';

/** Extensible, non-sensitive metadata for learning outputs. */
export type LearningOutputMetadata = Record<string, unknown>;

/**
 * Persisted learning output record in IndexedDB (Day 9).
 * Captures derived learning artifacts (summaries, notes, questions, etc.)
 * with source chunk traceability back to processed content.
 */
export interface LearningOutput {
    /** Unique record ID (UUID). Immutable after creation. */
    id: string;
    /** The parent resource ID. Immutable after creation. */
    resourceId: string;
    /** Output category. */
    type: LearningOutputType;
    /** String text or structured payload representing the learning output. */
    content: string | Record<string, unknown>;
    /** Traceability: references chunk indices or identifiers in the source processed content. */
    sourceChunkIds: (string | number)[];
    /** Extensible metadata (e.g. model, difficulty, keywords). */
    metadata: LearningOutputMetadata;
    /** ISO 8601 timestamps stored as UTC strings. */
    createdAt: string;
    updatedAt: string;
}

/** Structured payload for flashcard learning outputs (Day 12). */
export interface FlashcardContent {
    front: string;
    back: string;
}

/** Grouped flashcard deck collection for review (Day 12). */
export interface FlashcardDeck {
    resourceId: string;
    title: string;
    flashcards: LearningOutput[];
    count: number;
}

/** A single multiple-choice question in a Quiz (Day 13). */
export interface QuizQuestion {
    id: string;
    question: string;
    options: string[];
    correctAnswer: string;
    sourceChunkIds: (string | number)[];
    order: number;
}

/** Extensible, non-sensitive quiz metadata. */
export type QuizMetadata = Record<string, unknown>;

/** Persisted Quiz record in IndexedDB (Day 13). */
export interface Quiz {
    /** Unique record ID (UUID). Immutable after creation. */
    id: string;
    /** The parent resource ID. Immutable after creation. */
    resourceId: string;
    /** Quiz title, typically derived from the parent resource. */
    title: string;
    /** Ordered list of multiple-choice questions. */
    questions: QuizQuestion[];
    /** Extensible metadata (e.g. generator, difficulty). */
    metadata: QuizMetadata;
    /** ISO 8601 timestamps stored as UTC strings. */
    createdAt: string;
    updatedAt: string;
}

/** Per-question result in a completed quiz attempt (Day 14). */
export interface QuestionResult {
    questionId: string;
    question: string;
    selectedAnswer: string | null;
    correctAnswer: string;
    isCorrect: boolean;
    isUnanswered: boolean;
    sourceChunkIds: (string | number)[];
}

/** Persisted Quiz Attempt record in IndexedDB (Day 14). */
export interface QuizAttempt {
    id: string;
    quizId: string;
    resourceId: string;
    quizTitle: string;
    score: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    totalQuestions: number;
    percentage: number;
    answers: Record<string, string>;
    questionResults: QuestionResult[];
    startedAt: string;
    completedAt: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

/** Summary quiz performance metrics (Day 14). */
export interface QuizAnalytics {
    totalAttempts: number;
    totalQuizzesTaken: number;
    averageScore: number;
    highestScore: number;
    recentActivity: QuizAttempt[];
}

/** Extensible, non-sensitive note metadata (Day 15). */
export type NoteMetadata = Record<string, unknown>;

/** Persisted Note record in IndexedDB (Day 15). */
export interface Note {
    /** Unique record ID (UUID). Immutable after creation. */
    id: string;
    /** The parent resource ID, or null if standalone note. */
    resourceId: string | null;
    /** Note title. */
    title: string;
    /** Note content (plain or structured text). */
    content: string;
    /** Normalized tags array. */
    tags: string[];
    /** Extensible metadata. */
    metadata: NoteMetadata;
    /** ISO 8601 timestamps stored as UTC strings. */
    createdAt: string;
    updatedAt: string;
}


