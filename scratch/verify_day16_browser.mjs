import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5505;
const CDP_PORT = 9447;
const ROOT_DIR = 'C:\\StudyLens';

// MIME types dictionary for static file server
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.svg': 'image/svg+xml',
};

function createStaticServer() {
    return http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
        let filePath = path.join(ROOT_DIR, decodeURIComponent(parsedUrl.pathname));
        if (filePath.endsWith(path.sep) || fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + req.url);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.json();
        } catch {
            // retry
        }
        await sleep(200);
    }
    throw new Error(`Timeout waiting for ${url}`);
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
                if (msg.error) reject(new Error(msg.error.message));
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

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error('Evaluation error: ' + (result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)));
        }
        return result.result?.value;
    }
}

async function runVerification() {
    const server = createStaticServer();
    await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
    console.log(`[Day 16 Server] Static server listening at http://127.0.0.1:${HTTP_PORT}`);

    const userDataDir = mkdtempSync(join(tmpdir(), 'studylens-day16-verify-'));
    console.log(`[Day 16] Chrome User Data Dir: ${userDataDir}`);

    const chromeProcess = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ], { stdio: 'ignore' });

    try {
        console.log(`[Day 16] Waiting for Chrome CDP on port ${CDP_PORT}...`);
        await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
        console.log('[Day 16] Chrome ready.');

        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const pageTarget = targets.find((t) => t.type === 'page');
        if (!pageTarget?.webSocketDebuggerUrl) {
            throw new Error('No inspectable page target found');
        }

        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });
        const cdp = new CdpClient(ws);

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        // ==========================================
        // STEP 1: Run Storage Browser Suite (HTML)
        // ==========================================
        console.log('\n--- STEP 1: Running storage.browser.html ---');
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/tests/storage.browser.html` });
        await sleep(2000);

        const storageResults = await cdp.evaluate(`
            (async () => {
                const resultsEl = document.getElementById('test-results');
                const statusEl = document.getElementById('test-status');
                let waited = 0;
                while (waited < 8000) {
                    if (resultsEl && resultsEl.children.length > 0) break;
                    if (statusEl && statusEl.textContent.includes('failed')) break;
                    await new Promise(r => setTimeout(r, 200));
                    waited += 200;
                }
                const items = Array.from(document.querySelectorAll('#test-results li')).map(li => li.textContent);
                const status = statusEl?.textContent;
                return { items, status };
            })()
        `);

        console.log('Storage Suite Status:', storageResults.status);
        console.log('Passed checks count:', storageResults.items?.length);
        const hasV7Check = storageResults.items?.some(i => i.includes('v7 with fileBlobs'));
        const hasBlobSaveCheck = storageResults.items?.some(i => i.includes('File blob storage and retrieval'));
        const hasBlobDeleteCheck = storageResults.items?.some(i => i.includes('File blob deletion'));
        console.log('v7 Store schema check:', hasV7Check ? 'PASS' : 'FAIL');
        console.log('File blob save/get check:', hasBlobSaveCheck ? 'PASS' : 'FAIL');
        console.log('File blob delete check:', hasBlobDeleteCheck ? 'PASS' : 'FAIL');

        if (!hasV7Check || !hasBlobSaveCheck || !hasBlobDeleteCheck) {
            throw new Error('Storage browser suite failed Day 16 checks!');
        }

        // ==========================================
        // STEP 2: App Launch and Initial State
        // ==========================================
        console.log('\n--- STEP 2: App Launch & Initial State ---');
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html#dashboard` });
        await sleep(1500);

        const appState = await cdp.evaluate(`
            (() => {
                return {
                    storageState: document.documentElement.dataset.storageState,
                    hasFileImportDialog: Boolean(document.getElementById('file-import-dialog')),
                    pdfActionExists: Boolean(document.querySelector('[data-resource-action="pdf"]')),
                    imageActionExists: Boolean(document.querySelector('[data-resource-action="image"]')),
                    totalResources: document.querySelector('[data-stat="resources"]')?.textContent,
                };
            })()
        `);
        console.log('App state:', appState);
        if (appState.storageState !== 'ready') throw new Error('Storage state is not ready');
        if (!appState.hasFileImportDialog) throw new Error('File import dialog missing');

        // ==========================================
        // STEP 3: Quick Actions trigger File Import Dialog
        // ==========================================
        console.log('\n--- STEP 3: Quick Action PDF button opens dialog ---');
        await cdp.evaluate(`
            (() => {
                document.querySelector('[data-resource-action="pdf"]').click();
            })()
        `);
        await sleep(500);

        const pdfDialogState = await cdp.evaluate(`
            (() => {
                const dialog = document.getElementById('file-import-dialog');
                const title = document.querySelector('[data-file-import-title]')?.textContent;
                const accept = document.getElementById('file-import-input')?.getAttribute('accept');
                const submitDisabled = document.querySelector('[data-file-import-submit]')?.disabled;
                return {
                    open: dialog?.hasAttribute('open'),
                    title,
                    accept,
                    submitDisabled
                };
            })()
        `);
        console.log('PDF Import Dialog state:', pdfDialogState);
        if (!pdfDialogState.open) throw new Error('File import dialog did not open for PDF action');
        if (!pdfDialogState.title.includes('PDF')) throw new Error('Dialog title did not reflect PDF');

        // Close dialog
        await cdp.evaluate(`document.querySelector('#file-import-dialog [data-dialog-close]').click()`);
        await sleep(300);

        // ==========================================
        // STEP 4: Import PDF File End-to-End
        // ==========================================
        console.log('\n--- STEP 4: Import PDF Resource programmatically via importFile ---');
        const pdfImportResult = await cdp.evaluate(`
            (async () => {
                const { importFile } = await import('./js/features/fileImportService.js');
                const pdfContent = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
                const file = new File([pdfContent], 'physics_handbook.pdf', { type: 'application/pdf' });
                const resource = await importFile(file, {
                    title: 'Physics Handbook',
                    tags: 'physics, mechanics',
                });
                return resource;
            })()
        `);
        console.log('Imported PDF Resource:', {
            id: pdfImportResult.id,
            title: pdfImportResult.title,
            type: pdfImportResult.type,
            status: pdfImportResult.status,
            content: pdfImportResult.content,
            metadata: pdfImportResult.metadata,
        });

        if (pdfImportResult.type !== 'pdf') throw new Error('Resource type must be pdf');
        if (pdfImportResult.status !== 'pending') throw new Error('Resource status must be pending');
        if (pdfImportResult.content !== null) throw new Error('Resource content must be null');
        if (pdfImportResult.metadata?.originalFileName !== 'physics_handbook.pdf') throw new Error('Original file name mismatch');

        // ==========================================
        // STEP 5: Verify PDF in Resource Viewer
        // ==========================================
        console.log('\n--- STEP 5: Open PDF Resource in Viewer ---');
        await cdp.evaluate(`
            (async () => {
                const { openResourceViewer } = await import('./js/features/resourceViewer.js');
                await openResourceViewer('${pdfImportResult.id}');
            })()
        `);
        await sleep(800);

        const pdfViewerState = await cdp.evaluate(`
            (() => {
                const dialog = document.getElementById('resource-viewer-dialog');
                const title = document.querySelector('[data-resource-viewer-title]')?.textContent;
                const type = document.querySelector('[data-resource-viewer-type]')?.textContent;
                const status = document.querySelector('[data-resource-viewer-status]')?.textContent;
                const editHidden = document.querySelector('[data-resource-viewer-edit]')?.hidden;
                const generateDisabled = document.querySelector('[data-resource-viewer-generate]')?.disabled;
                const fileSectionHidden = document.querySelector('[data-resource-viewer-file-section]')?.hidden;
                const fileInfoText = document.querySelector('[data-resource-viewer-file-info]')?.textContent;
                const contentText = document.querySelector('[data-resource-viewer-content]')?.textContent;

                return {
                    open: dialog?.hasAttribute('open'),
                    title,
                    type,
                    status,
                    editHidden,
                    generateDisabled,
                    fileSectionHidden,
                    fileInfoText,
                    contentText,
                };
            })()
        `);
        console.log('PDF Viewer State:', pdfViewerState);

        if (!pdfViewerState.open) throw new Error('Resource viewer dialog not open');
        if (pdfViewerState.type !== 'pdf') throw new Error('Resource viewer type is not pdf');
        if (!pdfViewerState.editHidden) throw new Error('Edit button must be hidden for non-text');
        if (!pdfViewerState.generateDisabled) throw new Error('Generate button must be disabled when no content');
        if (pdfViewerState.fileSectionHidden) throw new Error('File section must be visible for PDF resource');
        if (!pdfViewerState.fileInfoText.includes('physics_handbook.pdf')) throw new Error('File info must show filename');

        // Close viewer
        await cdp.evaluate(`document.querySelector('#resource-viewer-dialog [data-dialog-close]').click()`);
        await sleep(300);

        // ==========================================
        // STEP 6: Import Image Resource & Verify Image Preview
        // ==========================================
        console.log('\n--- STEP 6: Import Image Resource & Preview ---');
        const imgImportResult = await cdp.evaluate(`
            (async () => {
                const { importFile } = await import('./js/features/fileImportService.js');
                // 1x1 transparent PNG bytes
                const pngBytes = new Uint8Array([
                    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
                    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
                    0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5,
                    0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
                ]);
                const file = new File([pngBytes], 'circuit_diagram.png', { type: 'image/png' });
                const resource = await importFile(file, {
                    title: 'Circuit Diagram',
                    tags: 'circuits, electronics',
                });
                return resource;
            })()
        `);
        console.log('Imported Image Resource:', {
            id: imgImportResult.id,
            title: imgImportResult.title,
            type: imgImportResult.type,
            status: imgImportResult.status,
            metadata: imgImportResult.metadata,
        });

        if (imgImportResult.type !== 'image') throw new Error('Resource type must be image');

        // Open Image Resource in Viewer
        await cdp.evaluate(`
            (async () => {
                const { openResourceViewer } = await import('./js/features/resourceViewer.js');
                await openResourceViewer('${imgImportResult.id}');
            })()
        `);
        await sleep(800);

        const imgViewerState = await cdp.evaluate(`
            (() => {
                const imageContainer = document.querySelector('[data-resource-viewer-image-preview]');
                const img = imageContainer?.querySelector('img');
                return {
                    containerHidden: imageContainer?.hidden,
                    hasImg: Boolean(img),
                    srcStartsBlob: img?.src?.startsWith('blob:'),
                };
            })()
        `);
        console.log('Image Viewer State:', imgViewerState);
        if (imgViewerState.containerHidden) throw new Error('Image preview container must be visible');
        if (!imgViewerState.hasImg) throw new Error('Image tag must exist');
        if (!imgViewerState.srcStartsBlob) throw new Error('Image src must be a blob URL');

        // Close viewer
        await cdp.evaluate(`document.querySelector('#resource-viewer-dialog [data-dialog-close]').click()`);
        await sleep(300);

        // ==========================================
        // STEP 7: Verify Library Filtering
        // ==========================================
        console.log('\n--- STEP 7: Library Filtering by Type ---');
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html#library` });
        await sleep(1000);

        const filterPdfCount = await cdp.evaluate(`
            (() => {
                const select = document.getElementById('resource-type');
                select.value = 'pdf';
                select.dispatchEvent(new Event('change'));
                const cards = document.querySelectorAll('[data-library-resource-list] .resource-card');
                return cards.length;
            })()
        `);
        console.log('Filtered by type="pdf" card count:', filterPdfCount);
        if (filterPdfCount !== 1) throw new Error('Expected 1 PDF resource in library');

        const filterImageCount = await cdp.evaluate(`
            (() => {
                const select = document.getElementById('resource-type');
                select.value = 'image';
                select.dispatchEvent(new Event('change'));
                const cards = document.querySelectorAll('[data-library-resource-list] .resource-card');
                return cards.length;
            })()
        `);
        console.log('Filtered by type="image" card count:', filterImageCount);
        if (filterImageCount !== 1) throw new Error('Expected 1 Image resource in library');

        // Clear filters
        await cdp.evaluate(`
            (() => {
                document.querySelector('[data-library-clear-filters]')?.click();
            })()
        `);
        await sleep(500);

        // ==========================================
        // STEP 8: Cascading Delete and File Blob Purge
        // ==========================================
        console.log('\n--- STEP 8: Cascading Delete & Blob Purge ---');
        const deleteResult = await cdp.evaluate(`
            (async () => {
                const { openResourceViewer } = await import('./js/features/resourceViewer.js');
                const { getFileBlob } = await import('./js/features/fileImportService.js');

                // Verify blob exists before delete
                const blobBefore = await getFileBlob('${imgImportResult.id}');

                // Open viewer and delete
                await openResourceViewer('${imgImportResult.id}');
                document.querySelector('[data-resource-viewer-delete]').click();
                await new Promise(r => setTimeout(r, 200));
                document.querySelector('[data-delete-resource-confirm]').click();
                await new Promise(r => setTimeout(r, 500));

                // Verify blob is removed after delete
                const blobAfter = await getFileBlob('${imgImportResult.id}');

                return {
                    hadBlobBefore: Boolean(blobBefore),
                    hasBlobAfter: Boolean(blobAfter),
                };
            })()
        `);
        console.log('Delete cascade blob result:', deleteResult);
        if (!deleteResult.hadBlobBefore) throw new Error('Blob should have existed before deletion');
        if (deleteResult.hasBlobAfter) throw new Error('Blob should have been purged on resource deletion');

        // ==========================================
        // STEP 9: Day 10-15 Regression Verification
        // ==========================================
        console.log('\n--- STEP 9: Day 10-15 Regression Verification ---');
        const regressionResult = await cdp.evaluate(`
            (async () => {
                const { resourceRepository } = await import('./js/storage/resourceStore.js');
                const { createTextResourceInput } = await import('./js/features/textResourceInput.js');
                const { processAndStore } = await import('./js/features/processingIntegration.js');
                const { generateLearningOutputsForResource } = await import('./js/features/learningOutputService.js');
                const { generateFlashcardsForResource, getFlashcardsForResource } = await import('./js/features/flashcardService.js');
                const { generateQuizForResource, getQuizForResource } = await import('./js/features/quizService.js');
                const { createNote, getNotesByResource } = await import('./js/features/noteService.js');

                // 1. Text resource create and process
                const textRes = await resourceRepository.createResource(createTextResourceInput({
                    title: 'Photosynthesis Fundamentals',
                    content: 'Photosynthesis is the biological process by which plants convert light energy into chemical energy. Chlorophyll is the pigment responsible for absorbing light.',
                    tags: 'biology, plant',
                }));
                await processAndStore(textRes);

                // 2. Learning outputs
                const outputs = await generateLearningOutputsForResource(textRes.id);

                // 3. Flashcards
                await generateFlashcardsForResource(textRes.id);
                const cards = await getFlashcardsForResource(textRes.id);

                // 4. Quiz
                await generateQuizForResource(textRes.id);
                const quiz = await getQuizForResource(textRes.id);

                // 5. Note
                const note = await createNote({
                    resourceId: textRes.id,
                    title: 'Photosynthesis Notes',
                    content: 'Study plant energy conversion.',
                    tags: 'bio',
                });

                return {
                    outputsCount: outputs.length,
                    flashcardsCount: cards.length,
                    quizQuestionsCount: quiz?.questions?.length || 0,
                    noteCreated: Boolean(note),
                };
            })()
        `);
        console.log('Regression Results:', regressionResult);
        if (regressionResult.outputsCount === 0) throw new Error('Learning output generation failed');
        if (regressionResult.flashcardsCount === 0) throw new Error('Flashcard generation failed');
        if (regressionResult.quizQuestionsCount === 0) throw new Error('Quiz generation failed');
        if (!regressionResult.noteCreated) throw new Error('Note creation failed');

        console.log('\n=============================================');
        console.log('>>> ALL DAY 16 BROWSER CHECKS PASSED 100%! <<<');
        console.log('=============================================\n');

    } finally {
        chromeProcess.kill();
        server.close();
        try {
            rmSync(userDataDir, { recursive: true, force: true });
        } catch {
            // cleanup
        }
    }
}

runVerification().catch((err) => {
    console.error('Browser Verification Error:', err);
    process.exit(1);
});
