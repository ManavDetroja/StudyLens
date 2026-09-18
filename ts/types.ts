/** Basic resource model */
export type ResourceType = 'video' | 'pdf' | 'image' | 'text';

export interface Resource {
    id: string; // UUID
    title: string;
    type: ResourceType;
    source: string; // URL or local path
    createdAt: string; // ISO timestamp
    tags?: string[];
    status?: 'pending' | 'processed';
}
