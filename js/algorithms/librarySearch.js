/**
 * Library search, filtering, and sorting — Day 5.
 *
 * Provides basic local exact-match search across resource title, content,
 * and tags. Resources are filtered in memory from a pre-loaded array.
 *
 * Pipeline order: search → type filter → status filter → tag filter → sort.
 *
 * Current limitation: this is a simple substring search, not fuzzy or
 * semantic. It is efficient for the expected local dataset size. If the
 * library grows to thousands of resources, consider indexing, pagination,
 * or Web Workers in a future version.
 */

/**
 * Normalize a string for case-insensitive, whitespace-tolerant comparison.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
    if (typeof text !== 'string') return '';
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Build a single searchable string from a resource's title, content, and tags.
 * @param {object} resource
 * @returns {string}
 */
function buildSearchableText(resource) {
    const parts = [
        resource.title ?? '',
        resource.content ?? '',
        ...(Array.isArray(resource.tags) ? resource.tags : []),
    ];
    return normalizeText(parts.join(' '));
}

/**
 * Search resources by query against title, content, and tags.
 * Returns all resources when the query is empty.
 * @param {object[]} resources
 * @param {string} query
 * @returns {object[]}
 */
export function searchResources(resources, query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return resources;

    return resources.filter((resource) => {
        return buildSearchableText(resource).includes(normalizedQuery);
    });
}

/**
 * Filter resources by type. Returns all resources when type is 'all' or empty.
 * @param {object[]} resources
 * @param {string} type
 * @returns {object[]}
 */
export function filterByType(resources, type) {
    if (!type || type === 'all') return resources;
    return resources.filter((resource) => resource.type === type);
}

/**
 * Filter resources by status. Returns all resources when status is 'all' or empty.
 * @param {object[]} resources
 * @param {string} status
 * @returns {object[]}
 */
export function filterByStatus(resources, status) {
    if (!status || status === 'all') return resources;
    return resources.filter((resource) => resource.status === status);
}

/**
 * Filter resources by tag. Returns all resources when tag is 'all' or empty.
 * Matching is exact and case-insensitive against normalized stored tags.
 * @param {object[]} resources
 * @param {string} tag
 * @returns {object[]}
 */
export function filterByTag(resources, tag) {
    if (!tag || tag === 'all') return resources;
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) return resources;
    return resources.filter((resource) =>
        Array.isArray(resource.tags) && resource.tags.some(
            (t) => (typeof t === 'string' ? t.trim().toLowerCase() : '') === normalizedTag,
        ),
    );
}

/**
 * Sort resources by the given sort key.
 *
 * Supported keys:
 *   'recent'   — newest first (createdAt descending)
 *   'oldest'   — oldest first (createdAt ascending)
 *   'title-az' — title A–Z (locale-aware, case-insensitive)
 *   'title-za' — title Z–A (locale-aware, case-insensitive)
 *   'updated'  — recently updated first (updatedAt descending)
 *
 * @param {object[]} resources
 * @param {string} sortKey
 * @returns {object[]}
 */
export function sortResources(resources, sortKey) {
    const sorted = [...resources];

    switch (sortKey) {
        case 'oldest':
            sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
            break;
        case 'title-az':
            sorted.sort((a, b) =>
                (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }),
            );
            break;
        case 'title-za':
            sorted.sort((a, b) =>
                (b.title ?? '').localeCompare(a.title ?? '', undefined, { sensitivity: 'base' }),
            );
            break;
        case 'updated':
            sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
            break;
        case 'recent':
        default:
            sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
            break;
    }

    return sorted;
}

/**
 * Apply all library filters in the documented pipeline order:
 * search → type filter → status filter → tag filter → sort.
 *
 * @param {object[]} resources
 * @param {{ query?: string, type?: string, status?: string, tag?: string, sort?: string }} filters
 * @returns {object[]}
 */
export function applyLibraryFilters(resources, { query = '', type = 'all', status = 'all', tag = 'all', sort = 'recent' } = {}) {
    let result = searchResources(resources, query);
    result = filterByType(result, type);
    result = filterByStatus(result, status);
    result = filterByTag(result, tag);
    result = sortResources(result, sort);
    return result;
}

/**
 * Check whether any filter is actively narrowing results beyond the default view.
 * Sorting alone does not count as a narrowing filter.
 *
 * @param {{ query?: string, type?: string, status?: string, tag?: string }} filters
 * @returns {boolean}
 */
export function isFiltered({ query = '', type = 'all', status = 'all', tag = 'all' } = {}) {
    return (typeof query === 'string' && query.trim() !== '')
        || type !== 'all'
        || status !== 'all'
        || tag !== 'all';
}
