import { ResourceValidationError } from './errors.js';

export const RESOURCE_TYPES = Object.freeze(['video', 'pdf', 'image', 'text']);
export const RESOURCE_STATUSES = Object.freeze(['pending', 'processing', 'completed', 'failed']);
export const DEFAULT_RESOURCE_STATUS = 'pending';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isValidIsoTimestamp(value) {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && !Number.isNaN(Date.parse(value));
}

function normalizeTitle(value) {
    return typeof value === 'string' ? value.trim() : value;
}

function normalizeTags(value) {
    if (!Array.isArray(value)) return value;
    return [...new Set(value.map((tag) => typeof tag === 'string' ? tag.trim() : tag))];
}

function createTimestamp(clock) {
    const value = clock();
    return value instanceof Date ? value.toISOString() : value;
}

export function generateResourceId() {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new ResourceValidationError('This browser cannot generate secure resource IDs.', {
            code: 'UUID_UNAVAILABLE',
        });
    }

    return globalThis.crypto.randomUUID();
}

export function validateResource(resource) {
    if (!isPlainObject(resource)) {
        throw new ResourceValidationError('A resource must be an object.');
    }

    const problems = [];

    if (typeof resource.id !== 'string' || resource.id.trim() === '') {
        problems.push('id must be a non-empty string');
    }
    if (typeof resource.title !== 'string' || resource.title.trim() === '') {
        problems.push('title must be a non-empty string');
    }
    if (!RESOURCE_TYPES.includes(resource.type)) {
        problems.push('type must be video, pdf, image, or text');
    }
    if (typeof resource.source !== 'string') {
        problems.push('source must be a string');
    }
    if (resource.content !== null && typeof resource.content !== 'string') {
        problems.push('content must be a string or null');
    }
    if (!isValidIsoTimestamp(resource.createdAt)) {
        problems.push('createdAt must be an ISO timestamp');
    }
    if (!isValidIsoTimestamp(resource.updatedAt)) {
        problems.push('updatedAt must be an ISO timestamp');
    }
    if (!RESOURCE_STATUSES.includes(resource.status)) {
        problems.push('status must be pending, processing, completed, or failed');
    }
    if (!Array.isArray(resource.tags) || resource.tags.some((tag) => typeof tag !== 'string' || tag === '')) {
        problems.push('tags must be an array of non-empty strings');
    }
    if (!isPlainObject(resource.metadata)) {
        problems.push('metadata must be an object');
    }
    if (isValidIsoTimestamp(resource.createdAt) && isValidIsoTimestamp(resource.updatedAt)
        && Date.parse(resource.updatedAt) < Date.parse(resource.createdAt)) {
        problems.push('updatedAt cannot be earlier than createdAt');
    }

    if (problems.length > 0) {
        throw new ResourceValidationError('Invalid resource: ' + problems.join('; ') + '.');
    }

    return resource;
}

export function createResourceRecord(input, {
    idGenerator = generateResourceId,
    clock = () => new Date(),
} = {}) {
    if (!isPlainObject(input)) {
        throw new ResourceValidationError('Resource input must be an object.');
    }

    const timestamp = createTimestamp(clock);
    const resource = {
        id: idGenerator(),
        title: normalizeTitle(input.title),
        type: input.type,
        source: input.source ?? '',
        content: input.content ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: input.status ?? DEFAULT_RESOURCE_STATUS,
        tags: normalizeTags(input.tags ?? []),
        metadata: input.metadata ?? {},
    };

    return validateResource(resource);
}

export function createUpdatedResource(existingResource, updates, {
    clock = () => new Date(),
} = {}) {
    validateResource(existingResource);

    if (!isPlainObject(updates)) {
        throw new ResourceValidationError('Resource updates must be an object.');
    }
    if (Object.hasOwn(updates, 'id') || Object.hasOwn(updates, 'createdAt')) {
        throw new ResourceValidationError('Resource id and createdAt cannot be changed.', {
            code: 'IMMUTABLE_RESOURCE_FIELD',
        });
    }

    const allowedFields = ['title', 'type', 'source', 'content', 'status', 'tags', 'metadata'];
    const allowedUpdates = {};

    allowedFields.forEach((field) => {
        if (Object.hasOwn(updates, field)) allowedUpdates[field] = updates[field];
    });

    const resource = {
        ...existingResource,
        ...allowedUpdates,
        title: Object.hasOwn(allowedUpdates, 'title') ? normalizeTitle(allowedUpdates.title) : existingResource.title,
        tags: Object.hasOwn(allowedUpdates, 'tags') ? normalizeTags(allowedUpdates.tags) : existingResource.tags,
        updatedAt: createTimestamp(clock),
    };

    return validateResource(resource);
}
