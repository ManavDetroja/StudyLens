/**
 * PDF.js loader module — Day 17.
 *
 * Provides a universal loader for PDF.js across browser environments
 * (window.pdfjsLib) and Node.js testing environments (createRequire).
 */

let configured = false;

export async function getPdfJs() {
    if (globalThis.pdfjsLib) {
        configureWorker(globalThis.pdfjsLib);
        return globalThis.pdfjsLib;
    }

    if (typeof window !== 'undefined' && window.pdfjsLib) {
        globalThis.pdfjsLib = window.pdfjsLib;
        configureWorker(globalThis.pdfjsLib);
        return globalThis.pdfjsLib;
    }

    // Node.js test environment fallback
    if (typeof process !== 'undefined' && process.versions?.node) {
        try {
            const { createRequire } = await import('node:module');
            const path = await import('node:path');
            const require = createRequire(import.meta.url);
            const pdfjsPath = path.resolve('./js/vendor/pdf/pdf.js');
            const pdfjs = require(pdfjsPath);
            globalThis.pdfjsLib = pdfjs;
            configureWorker(pdfjs);
            return pdfjs;
        } catch (nodeError) {
            console.warn('Could not load PDF.js in Node environment.', nodeError);
        }
    }

    throw new Error('PDF.js library is not available in the current environment.');
}

function configureWorker(pdfjs) {
    if (configured || !pdfjs?.GlobalWorkerOptions) return;
    if (typeof window !== 'undefined') {
        pdfjs.GlobalWorkerOptions.workerSrc = './js/vendor/pdf/pdf.worker.min.js';
        configured = true;
    }
}
