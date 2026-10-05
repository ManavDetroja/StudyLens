import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5503;
const CDP_PORT = 9457;
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
    console.log('=== Starting Day 20 Unified Content Processing Browser Verification ===\n');

    const tempProfileDir = mkdtempSync(join(tmpdir(), 'studylens-day20-'));
    let server;
    let chromeProc;

    try {
        console.log(`1. Starting static web server on port ${HTTP_PORT}...`);
        server = await createStaticServer(PROJECT_DIR, HTTP_PORT);

        console.log(`2. Launching Headless Chrome (CDP port ${CDP_PORT})...`);
        chromeProc = spawn(CHROME_PATH, [
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${tempProfileDir}`,
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            'about:blank',
        ]);

        // Wait for CDP endpoint
        let versionData = null;
        for (let i = 0; i < 40; i++) {
            await sleep(250);
            try {
                const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
                if (res.ok) {
                    versionData = await res.json();
                    break;
                }
            } catch {}
        }
        if (!versionData) throw new Error('Chrome did not respond on CDP port');

        console.log('3. Connecting to Chrome CDP websocket endpoint...');
        const versionRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const targets = await versionRes.json();
        const pageTarget = targets.find((t) => t.type === 'page');
        if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
            throw new Error('No page debug target found.');
        }

        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        const cdp = new CdpClient(ws);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        console.log('Connected to CDP successfully.');

        console.log(`Navigating to http://127.0.0.1:${HTTP_PORT}/...`);
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
        await sleep(2000);

        // Step 1: Verify Initial App State
        console.log('--- Step 1: Verifying Initial App Boot & Shell ---');
        const title = await cdp.evaluate('document.title');
        console.log('Document title:', title);
        const hasDashboard = await cdp.evaluate('Boolean(document.querySelector("#dashboard"))');
        console.log('Dashboard present:', hasDashboard);
        if (!hasDashboard) throw new Error('Application failed to boot properly.');

        // Step 2: Verify Source Adapter Registry
        console.log('\n--- Step 2: Verifying Source Adapter Registry in Browser ---');
        const registryCheck = await cdp.evaluate(`(async () => {
            const { sourceAdapterRegistry } = await import('/js/processing/sourceAdapterRegistry.js');
            const adapters = sourceAdapterRegistry.getAllAdapters();
            const textAdap = sourceAdapterRegistry.findAdapter({ type: 'text' });
            const pdfAdap = sourceAdapterRegistry.findAdapter({ type: 'pdf' });
            const imgAdap = sourceAdapterRegistry.findAdapter({ type: 'image' });
            const unkAdap = sourceAdapterRegistry.findAdapter({ type: 'video' });
            return {
                totalCount: adapters.length,
                adapterIds: adapters.map(a => a.id),
                hasText: Boolean(textAdap),
                hasPdf: Boolean(pdfAdap),
                hasImage: Boolean(imgAdap),
                rejectsUnknown: unkAdap === null,
            };
        })()`);
        console.log('Registry check:', registryCheck);
        if (registryCheck.totalCount < 3 || !registryCheck.hasImage || !registryCheck.rejectsUnknown) {
            throw new Error('Registry failed browser check: ' + JSON.stringify(registryCheck));
        }

        // Step 3: Test Unified Processing of Image Resource
        console.log('\n--- Step 3: Processing Image Resource via Unified Orchestrator ---');
        const imageProcessingResult = await cdp.evaluate(`(async () => {
            const { resourceRepository } = await import('/js/storage/resourceStore.js');
            const { processAndStore, getProcessedContent } = await import('/js/features/processingIntegration.js');

            // Create image resource with note text
            const imageRes = await resourceRepository.createResource({
                title: 'Operating System Architecture Diagram',
                type: 'image',
                source: 'local://file-import',
                content: 'Kernel is the core component of an operating system. Virtual memory allows processes to execute without requiring contiguous physical memory allocation. Process scheduling is managed by the CPU scheduler.',
                status: 'pending',
                tags: ['os', 'architecture'],
                metadata: {
                    originalFileName: 'os_diagram.png',
                    mimeType: 'image/png',
                    fileSize: 409600,
                },
            });

            // Process through unified orchestrator
            const processed = await processAndStore(imageRes);
            const updatedRes = await resourceRepository.getResource(imageRes.id);

            return {
                resourceId: imageRes.id,
                status: updatedRes.status,
                extractedContent: updatedRes.content,
                chunksCount: processed.chunks.length,
                sourceType: processed.sourceType,
                adapterId: processed.metadata?.adapterId,
            };
        })()`);
        console.log('Image processing result:', imageProcessingResult);
        if (imageProcessingResult.status !== 'completed' || imageProcessingResult.chunksCount < 1) {
            throw new Error('Image processing failed: ' + JSON.stringify(imageProcessingResult));
        }

        // Step 4: Verify Concurrency Locking
        console.log('\n--- Step 4: Verifying Concurrency Locking Guard ---');
        const lockCheck = await cdp.evaluate(`(async () => {
            const { resourceRepository } = await import('/js/storage/resourceStore.js');
            const { processAndStore, isResourceProcessing } = await import('/js/features/processingIntegration.js');

            const res = await resourceRepository.createResource({
                title: 'Concurrency Test Doc',
                type: 'text',
                content: 'Concurrency control ensures correct results for concurrent operations.',
                status: 'pending',
                tags: ['concurrency'],
            });

            // Fire first and immediate second
            let secondThrewLockError = false;
            const p1 = processAndStore(res);
            try {
                await processAndStore(res);
            } catch (err) {
                secondThrewLockError = err.code === 'PROCESSING_ALREADY_IN_PROGRESS';
            }
            await p1;

            return {
                secondThrewLockError,
                isLockedAfterCompletion: isResourceProcessing(res.id),
            };
        })()`);
        console.log('Lock check result:', lockCheck);
        if (!lockCheck.secondThrewLockError || lockCheck.isLockedAfterCompletion) {
            throw new Error('Concurrency lock failed: ' + JSON.stringify(lockCheck));
        }

        // Step 5: Verify Idempotent Reprocessing
        console.log('\n--- Step 5: Verifying Reprocessing Idempotency & Clean Chunks ---');
        const idempotencyCheck = await cdp.evaluate(`(async () => {
            const { resourceRepository } = await import('/js/storage/resourceStore.js');
            const { processAndStore, getProcessedContent } = await import('/js/features/processingIntegration.js');

            const res = await resourceRepository.createResource({
                title: 'Idempotency Doc',
                type: 'text',
                content: 'Initial text statement for testing chunk replacement.',
                status: 'pending',
                tags: ['test'],
            });

            // Run 1
            await processAndStore(res);
            const firstRun = await getProcessedContent(res.id);
            const count1 = firstRun.chunks.length;

            // Update content & Reprocess (Run 2)
            await resourceRepository.updateResource(res.id, {
                content: 'Updated text content replacing initial statement.',
            });
            const updated = await resourceRepository.getResource(res.id);
            await processAndStore(updated);
            const secondRun = await getProcessedContent(res.id);
            const count2 = secondRun.chunks.length;

            return {
                count1,
                count2,
                textUpdated: secondRun.normalizedText.includes('Updated text content'),
                noDuplicateAccumulation: count2 === 1,
            };
        })()`);
        console.log('Idempotency check:', idempotencyCheck);
        if (!idempotencyCheck.noDuplicateAccumulation || !idempotencyCheck.textUpdated) {
            throw new Error('Reprocessing accumulated duplicate chunks: ' + JSON.stringify(idempotencyCheck));
        }

        // Step 6: Verify Downstream Study Aids on Processed Image Resource
        console.log('\n--- Step 6: Generating Learning Outputs, Flashcards, and Quiz for Image Resource ---');
        const downstreamParityCheck = await cdp.evaluate(`(async () => {
            const { getProcessedContent } = await import('/js/features/processingIntegration.js');
            const { resourceRepository } = await import('/js/storage/resourceStore.js');
            const { generateLearningOutputs } = await import('/js/processing/learningOutputGenerator.js');
            const { generateFlashcards } = await import('/js/processing/flashcardGenerator.js');
            const { generateQuiz } = await import('/js/processing/quizGenerator.js');

            const imageResId = '${imageProcessingResult.resourceId}';
            const res = await resourceRepository.getResource(imageResId);
            const processed = await getProcessedContent(imageResId);

            // 1. Learning outputs
            const outputs = generateLearningOutputs(processed);
            const concepts = outputs.filter(o => o.type === 'concept');
            const definitions = outputs.filter(o => o.type === 'definition');
            const questions = outputs.filter(o => o.type === 'question');

            // 2. Flashcards
            const flashcards = generateFlashcards(outputs, imageResId);

            // 3. Quiz
            const quiz = generateQuiz(outputs, res);

            return {
                totalOutputs: outputs.length,
                conceptCount: concepts.length,
                definitionCount: definitions.length,
                questionCount: questions.length,
                flashcardCount: flashcards.length,
                quizQuestionCount: quiz?.questions?.length || 0,
                allHaveSourceChunkIds: outputs.every(o => Array.isArray(o.sourceChunkIds) && o.sourceChunkIds.length > 0),
                flashcardGrounded: flashcards.every(f => Boolean(f.content.back) && f.sourceChunkIds.length > 0),
                quizOptionsValid: quiz.questions.every(q => q.options.length >= 2 && q.options.includes(q.correctAnswer)),
            };
        })()`);
        console.log('Downstream parity check:', downstreamParityCheck);
        if (!downstreamParityCheck.allHaveSourceChunkIds || !downstreamParityCheck.flashcardGrounded || !downstreamParityCheck.quizOptionsValid) {
            throw new Error('Downstream feature parity failed: ' + JSON.stringify(downstreamParityCheck));
        }

        // Step 7: Verify Resource Viewer UI Integration
        console.log('\n--- Step 7: Verifying Resource Viewer UI Actions ---');
        const uiCheck = await cdp.evaluate(`(async () => {
            const { openResourceViewer } = await import('/js/features/resourceViewer.js');
            await openResourceViewer('${imageProcessingResult.resourceId}');

            const dialog = document.querySelector('#resource-viewer-dialog');
            const title = document.querySelector('[data-resource-viewer-title]')?.textContent;
            const type = document.querySelector('[data-resource-viewer-type]')?.textContent;
            const status = document.querySelector('[data-resource-viewer-status]')?.textContent;
            const extractBtn = document.querySelector('[data-resource-viewer-extract-pdf]');
            const extractBtnText = extractBtn?.textContent;
            const extractBtnHidden = extractBtn?.hidden;

            return {
                isOpen: dialog?.open,
                title,
                type,
                status,
                extractBtnText,
                extractBtnHidden,
            };
        })()`);
        console.log('UI Check:', uiCheck);
        if (!uiCheck.isOpen || uiCheck.type !== 'image' || uiCheck.status !== 'completed' || uiCheck.extractBtnHidden) {
            throw new Error('Resource viewer UI failed check: ' + JSON.stringify(uiCheck));
        }

        console.log('\n🎉 ALL DAY 20 BROWSER VERIFICATION CHECKS PASSED SUCCESSFULLY!');

    } finally {
        if (chromeProc) {
            chromeProc.kill('SIGKILL');
        }
        if (server) {
            server.close();
        }
        try {
            rmSync(tempProfileDir, { recursive: true, force: true });
        } catch {
            // Ignore temp dir cleanup errors
        }
    }
}

runBrowserVerification().catch((err) => {
    console.error('Browser verification failed:', err);
    process.exit(1);
});
