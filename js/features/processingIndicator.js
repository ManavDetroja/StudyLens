/**
 * Processing indicator — Day 22.
 *
 * A lightweight, always-available status line ("Processing 1 resource · 2 queued")
 * driven by processing events. It also runs stale-job recovery on startup and
 * periodically, so a `processing` status left behind by a closed tab becomes a
 * retryable failure instead of spinning forever.
 *
 * Not a job dashboard: no per-job controls, no history.
 */

import { onProcessingChanged } from '../core/resourceEvents.js';
import { getProcessingSnapshot, recoverStaleProcessing, PROCESSING_CONFIG } from './processingService.js';

const SWEEP_INTERVAL_MS = 30_000;

export function formatProcessingSummary(snapshot) {
    const processing = snapshot?.processingCount ?? 0;
    const queued = snapshot?.queuedCount ?? 0;
    if (processing === 0 && queued === 0) return '';

    const parts = [];
    if (processing > 0) {
        parts.push(processing === 1 ? 'Processing 1 resource' : `Processing ${processing} resources`);
    }
    if (queued > 0) {
        parts.push(`${queued} queued`);
    }
    return parts.join(' · ');
}

function renderIndicator() {
    const container = document.querySelector('[data-processing-indicator]');
    const text = document.querySelector('[data-processing-indicator-text]');
    if (!container || !text) return;

    const summary = formatProcessingSummary(getProcessingSnapshot());
    text.textContent = summary;
    container.hidden = summary === '';
}

async function sweepStaleJobs() {
    try {
        await recoverStaleProcessing({ thresholdMs: PROCESSING_CONFIG.staleThresholdMs });
    } catch (error) {
        console.warn('StudyLens could not check for interrupted processing.', error);
    }
}

export async function initProcessingIndicator() {
    onProcessingChanged(renderIndicator);
    renderIndicator();

    await sweepStaleJobs();
    setInterval(() => { void sweepStaleJobs(); }, SWEEP_INTERVAL_MS);
}
