import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5505;
const CDP_PORT = 9459;
const PROJECT_DIR = 'C:\\StudyLens';

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
};

function createStaticServer(baseDir, port) {
    const server = http.createServer((req, res) => {
        let reqPath = decodeURI(req.url.split('?')[0]);
        if (reqPath === '/') reqPath = '/index.html';
        const filePath = path.join(baseDir, reqPath);

        if (!filePath.startsWith(baseDir)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not Found: ' + reqPath);
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache',
            });
            res.end(data);
        });
    });

    return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
            resolve(server);
        });
    });
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else resolve(msg.result);
            }
        };
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.id;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression, awaitPromise = true) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise,
        });
        if (result.exceptionDetails) {
            const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
            throw new Error('CDP Evaluate Exception: ' + desc);
        }
        return result.result?.value;
    }
}

async function runBrowserVerification() {
    console.log('=== Starting Day 22 Browser Verification ===');
    const server = await createStaticServer(PROJECT_DIR, HTTP_PORT);
    console.log(`Static server running on http://127.0.0.1:${HTTP_PORT}`);

    const userDataDir = mkdtempSync(join(tmpdir(), 'studylens-day22-test-'));
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        `http://127.0.0.1:${HTTP_PORT}/index.html`,
    ]);

    await sleep(2500);

    let client;
    try {
        const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        const targets = await listRes.json();
        const pageTarget = targets.find((t) => t.type === 'page');
        if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
            throw new Error('No page target with webSocketDebuggerUrl found');
        }

        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
            ws.onopen = res;
            ws.onerror = rej;
        });

        client = new CdpClient(ws);
        await client.send('Page.enable');
        await client.send('Runtime.enable');

        const consoleErrors = [];
        client.ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                    consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
                }
            } catch {}
        });

        console.log('Connected to Headless Chrome via CDP.');

        // Wait for app to boot
        await sleep(1500);

        // Verification 1: DOM Elements exist
        console.log('\n[Check 1] Global Processing Indicator DOM presence');
        const indicator = await client.evaluate(`(() => {
            const el = document.getElementById('processing-indicator');
            return {
                exists: Boolean(el),
                hasAriaLive: el ? el.getAttribute('aria-live') === 'polite' : false,
                hidden: el ? el.hasAttribute('hidden') : false,
            };
        })()`);
        console.log('Indicator check:', indicator);
        if (!indicator.exists || !indicator.hasAriaLive) {
            throw new Error('Global processing indicator missing or missing aria-live!');
        }

        // Verification 2: Enqueue a test resource and observe queue lifecycle
        console.log('\n[Check 2] Programmatic enqueue & global indicator activation');
        const queueLifecycleResult = await client.evaluate(`(async () => {
            const { resourceRepository } = await import('./js/storage/resourceStore.js');
            const { requestProcessing, getProcessingQueue } = await import('./js/features/processingService.js');
            const { onProcessingChanged } = await import('./js/core/resourceEvents.js');

            const res = await resourceRepository.createResource({
                title: 'Queue Test Resource',
                type: 'text',
                source: 'manual://text-entry',
                content: 'Cellular respiration converts biochemical energy from nutrients into ATP.\\n\\nGlycolysis is the first metabolic pathway.',
                tags: ['biology'],
            });

            const events = [];
            const unsub = onProcessingChanged((evt) => {
                if (evt.resourceId === res.id) {
                    events.push(evt.action);
                }
            });

            const req = await requestProcessing(res.id);
            const liveJob = req.job;
            const completion = await req.completion;

            unsub();

            const ind = document.getElementById('processing-indicator');

            return {
                resourceId: res.id,
                liveJobStatus: liveJob.status,
                completionStatus: completion.status,
                eventsReceived: events,
                indicatorFinalHidden: ind.hasAttribute('hidden'),
            };
        })()`);
        console.log('Queue lifecycle result:', queueLifecycleResult);
        if (queueLifecycleResult.completionStatus !== 'completed') {
            throw new Error('Queue completion status was not completed: ' + queueLifecycleResult.completionStatus);
        }

        // Verification 3: Processed Content integrity and Resource Viewer
        console.log('\n[Check 3] Resource Viewer with processed content & downstream buttons');
        const viewerCheck = await client.evaluate(`(async () => {
            const { openResourceViewer } = await import('./js/features/resourceViewer.js');
            const { resourceRepository } = await import('./js/storage/resourceStore.js');
            const { processedContentRepository } = await import('./js/storage/processedContentStore.js');

            const res = await resourceRepository.getResource('${queueLifecycleResult.resourceId}');
            const processed = await processedContentRepository.getByResourceId('${queueLifecycleResult.resourceId}');

            await openResourceViewer(res.id);

            const statusPanel = document.querySelector('[data-processing-status-panel]');
            const genBtn = document.querySelector('[data-resource-viewer-generate]');
            const flashBtn = document.querySelector('[data-resource-viewer-generate-flashcards]');
            const quizBtn = document.querySelector('[data-resource-viewer-generate-quiz]');

            return {
                resStatus: res.status,
                hasProcessedRecord: Boolean(processed),
                chunkCount: processed?.chunks?.length || 0,
                genBtnDisabled: genBtn?.disabled,
                flashBtnDisabled: flashBtn?.disabled,
                quizBtnDisabled: quizBtn?.disabled,
                statusPanelDisplay: statusPanel ? window.getComputedStyle(statusPanel).display : null,
            };
        })()`);
        console.log('Viewer check result:', viewerCheck);
        if (!viewerCheck.hasProcessedRecord || viewerCheck.chunkCount === 0) {
            throw new Error('Processed content chunks were not saved properly!');
        }

        // Verification 4: Downstream generation works smoothly
        console.log('\n[Check 4] Generate Learning Outputs, Flashcards, Quiz on processed resource');
        const downstreamResult = await client.evaluate(`(async () => {
            const { generateLearningOutputsForResource } = await import('./js/features/learningOutputService.js');
            const { generateFlashcardsForResource } = await import('./js/features/flashcardService.js');
            const { generateQuizForResource } = await import('./js/features/quizService.js');

            const outputs = await generateLearningOutputsForResource('${queueLifecycleResult.resourceId}');
            const flash = await generateFlashcardsForResource('${queueLifecycleResult.resourceId}');
            const quiz = await generateQuizForResource('${queueLifecycleResult.resourceId}');

            return {
                outputsCount: outputs.outputs.length,
                flashcardsCount: flash.flashcards.length,
                quizQuestionsCount: quiz.quiz.questions.length,
            };
        })()`);
        console.log('Downstream generated counts:', downstreamResult);
        if (downstreamResult.outputsCount === 0 || downstreamResult.flashcardsCount === 0 || downstreamResult.quizQuestionsCount === 0) {
            throw new Error('Downstream generation failed to produce outputs!');
        }

        // Verification 5: Queue cancellation of a queued job
        console.log('\n[Check 5] Cancel queued waiting job in browser');
        const cancelResult = await client.evaluate(`(async () => {
            const { resourceRepository } = await import('./js/storage/resourceStore.js');
            const { getProcessingQueue, cancelProcessing } = await import('./js/features/processingService.js');

            // Pause queue by running a long dummy job or inspecting cancel
            const q = getProcessingQueue();
            const resQueued = await resourceRepository.createResource({
                title: 'Cancel Me',
                type: 'text',
                content: 'Some text',
            });

            // Enqueue
            const { job, completion } = q.enqueue(resQueued.id);
            // Cancel immediately before or while queued
            const cancelResp = cancelProcessing(resQueued.id);

            return {
                cancelled: cancelResp.cancelled,
                reason: cancelResp.reason,
            };
        })()`);
        console.log('Cancel result:', cancelResult);

        // Verification 6: Failed state with Retry button and Downstream button protection
        console.log('\n[Check 6] Failed resource status panel and downstream generation protection');
        const failedResourceResult = await client.evaluate(`(async () => {
            const { resourceRepository } = await import('./js/storage/resourceStore.js');
            const { openResourceViewer } = await import('./js/features/resourceViewer.js');
            const { getProcessingDisplay } = await import('./js/processing/processingDisplay.js');

            // Create a failed resource with retryable error
            const failedRes = await resourceRepository.createResource({
                title: 'Failed Video',
                type: 'video',
                source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                status: 'failed',
                metadata: {
                    processingError: 'Network timed out while acquiring transcript.',
                    processingErrorCode: 'NETWORK_TIMEOUT',
                    processingRetryable: true,
                },
            });

            await openResourceViewer(failedRes.id);

            const statusPanel = document.querySelector('[data-resource-viewer-processing]');
            const retryBtn = document.querySelector('[data-resource-viewer-retry-processing]');
            const genBtn = document.querySelector('[data-resource-viewer-generate]');
            const messageEl = document.querySelector('[data-resource-viewer-processing-text]');

            const display = getProcessingDisplay(failedRes);

            return {
                panelVisible: Boolean(statusPanel && !statusPanel.hidden),
                hasRetryBtn: Boolean(retryBtn && !retryBtn.hidden),
                message: messageEl?.textContent,
                genBtnDisabled: genBtn?.disabled,
                displayCanRetry: display.canRetry,
                displayState: display.state,
            };
        })()`);
        console.log('Failed resource panel check:', failedResourceResult);
        if (!failedResourceResult.hasRetryBtn || !failedResourceResult.genBtnDisabled) {
            throw new Error('Failed resource did not present retry button or disable generation!');
        }

        // Verification 7: Stale recovery
        console.log('\n[Check 7] Stale processing recovery resets interrupted status');
        const staleRecoveryResult = await client.evaluate(`(async () => {
            const { resourceRepository } = await import('./js/storage/resourceStore.js');
            const { recoverStaleProcessing } = await import('./js/features/processingService.js');
            const { STALE_PROCESSING_THRESHOLD_MS } = await import('./js/processing/processingDisplay.js');

            const oldTime = new Date(Date.now() - (STALE_PROCESSING_THRESHOLD_MS + 20_000)).toISOString();
            const staleRes = await resourceRepository.createResource({
                title: 'Interrupted Job',
                type: 'pdf',
                status: 'processing',
                metadata: { processingStartedAt: oldTime },
            });

            const recoveredIds = await recoverStaleProcessing({ now: Date.now() });
            const afterRes = await resourceRepository.getResource(staleRes.id);

            return {
                recoveredIds,
                includesStale: recoveredIds.includes(staleRes.id),
                statusAfter: afterRes.status,
                retryable: afterRes.metadata.processingRetryable,
                errorCode: afterRes.metadata.processingErrorCode,
            };
        })()`);
        console.log('Stale recovery result:', staleRecoveryResult);
        if (!staleRecoveryResult.includesStale || staleRecoveryResult.statusAfter !== 'failed') {
            throw new Error('Stale processing recovery failed to mark interrupted job as failed!');
        }

        console.log('\n[Console Errors Check]');
        const filteredErrors = consoleErrors.filter(
            (err) => !err.includes('favicon.ico')
        );
        console.log(`Console error count: ${filteredErrors.length}`);
        if (filteredErrors.length > 0) {
            console.warn('Console errors caught:', filteredErrors);
        }

        console.log('\n=== Day 22 Browser Verification PASSED Successfully! ===');
    } finally {
        if (chrome) {
            chrome.kill('SIGTERM');
        }
        if (server) {
            server.close();
        }
        try {
            rmSync(userDataDir, { recursive: true, force: true });
        } catch {}
    }
}

runBrowserVerification().catch((err) => {
    console.error('Browser verification failed:', err);
    process.exit(1);
});
