/**
 * Source Adapter Registry — Day 20.
 *
 * Centralized registry for multimodal source adapters (Text, PDF, Image, etc.).
 * Ensures consistent discovery, validation, and lifecycle management for
 * content extraction and normalization pipelines.
 */

import { ContentProcessingError } from './errors.js';
import { textAdapter } from './textAdapter.js';
import { pdfAdapter } from './pdfAdapter.js';
import { imageAdapter } from './imageAdapter.js';
import { videoAdapter } from './videoAdapter.js';

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function assertAdapterContract(adapter) {
    if (!isPlainObject(adapter)
        || typeof adapter.id !== 'string'
        || adapter.id.trim() === ''
        || typeof adapter.canHandle !== 'function'
        || typeof adapter.extract !== 'function'
        || typeof adapter.normalize !== 'function') {
        throw new ContentProcessingError('A content adapter must provide id, canHandle, extract, and normalize methods.', {
            code: 'INVALID_ADAPTER',
        });
    }
}

export class SourceAdapterRegistry {
    constructor(initialAdapters = []) {
        this._adapters = new Map();
        if (Array.isArray(initialAdapters)) {
            initialAdapters.forEach((adapter) => this.registerAdapter(adapter));
        }
    }

    /**
     * Register a source adapter.
     * @param {object} adapter
     * @returns {SourceAdapterRegistry} this
     */
    registerAdapter(adapter) {
        assertAdapterContract(adapter);
        this._adapters.set(adapter.id, adapter);
        return this;
    }

    /**
     * Unregister an adapter by its identifier.
     * @param {string} id
     * @returns {boolean} true if an adapter was removed
     */
    unregisterAdapter(id) {
        return this._adapters.delete(id);
    }

    /**
     * Retrieve an adapter by its identifier.
     * @param {string} id
     * @returns {object|null}
     */
    getAdapter(id) {
        return this._adapters.get(id) ?? null;
    }

    /**
     * Check if an adapter identifier is registered.
     * @param {string} id
     * @returns {boolean}
     */
    hasAdapter(id) {
        return this._adapters.has(id);
    }

    /**
     * Find the first registered adapter capable of processing the given resource.
     * @param {object} resource
     * @returns {object|null}
     */
    findAdapter(resource) {
        if (!resource || typeof resource !== 'object') return null;
        for (const adapter of this._adapters.values()) {
            try {
                if (adapter.canHandle(resource)) {
                    return adapter;
                }
            } catch {
                // Ignore errors from adapter inspection
            }
        }
        return null;
    }

    /**
     * Return an array of all registered adapters in registration order.
     * @returns {object[]}
     */
    getAllAdapters() {
        return Array.from(this._adapters.values());
    }

    /**
     * Clear all registered adapters.
     */
    clear() {
        this._adapters.clear();
    }

    /**
     * Reset registry to default set of built-in adapters (Text, PDF, Image).
     */
    resetDefaultAdapters() {
        this.clear();
        this.registerAdapter(textAdapter);
        this.registerAdapter(pdfAdapter);
        this.registerAdapter(imageAdapter);
        this.registerAdapter(videoAdapter);
    }
}

/**
 * Default global instance populated with default adapters.
 */
export const sourceAdapterRegistry = new SourceAdapterRegistry([
    textAdapter,
    pdfAdapter,
    imageAdapter,
    videoAdapter,
]);
