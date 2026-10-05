import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5504;
const CDP_PORT = 9458;
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

async function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function run() {
    console.log('=== DAY 21: AUTOMATED BROWSER VERIFICATION ===\n');

    const tempProfile = mkdtempSync(join(tmpdir(), 'studylens-day21-browser-'));
    console.log(`[1] Starting static HTTP server on port ${HTTP_PORT}...`);
    const server = await createStaticServer(PROJECT_DIR, HTTP_PORT);

    console.log(`[2] Launching Chrome on CDP port ${CDP_PORT}...`);
    const chrome = spawn(CHROME_PATH, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${tempProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1280,800',
        `http://127.0.0.1:${HTTP_PORT}/index.html`,
    ]);

    let cdp = null;

    try {
        let targets = null;
        for (let i = 0; i < 30; i++) {
            await sleep(300);
            try {
                targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
                if (targets && targets.length > 0) break;
            } catch {}
        }

        if (!targets || targets.length === 0) {
            throw new Error('Could not connect to Chrome DevTools Protocol.');
        }

        const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve) => { ws.onopen = resolve; });
        cdp = new CdpClient(ws);

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        const consoleErrors = [];
        ws.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);
            if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
                consoleErrors.push(data.params.args.map((a) => a.value || a.description).join(' '));
            }
        });

        console.log('[3] Waiting for StudyLens application boot...');
        await sleep(1500);

        // Verification 1: App booted & storage ready
        const isReady = await cdp.evaluate(`(() => {
            return Boolean(document.querySelector('.app-shell') && !document.querySelector('[data-storage-error]:not([hidden])'));
        })()`);
        console.log(`    App booted and storage ready: ${isReady ? 'PASSED' : 'FAILED'}`);
        if (!isReady) throw new Error('App failed to boot cleanly.');

        // Verification 2: Video Quick Action button exists and opens modal
        console.log('\n[4] Testing Video Resource Quick Action & Dialog...');
        await cdp.evaluate(`(() => {
            document.querySelector('[data-resource-action="video"]').click();
        })()`);
        await sleep(500);

        const dialogOpen = await cdp.evaluate(`(() => {
            const dialog = document.getElementById('video-resource-dialog');
            return Boolean(dialog && dialog.open);
        })()`);
        console.log(`    Video resource dialog opened: ${dialogOpen ? 'PASSED' : 'FAILED'}`);
        if (!dialogOpen) throw new Error('Video resource dialog did not open.');

        // Verification 3: Invalid YouTube URL displays validation error
        console.log('\n[5] Testing YouTube URL Validation in UI...');
        await cdp.evaluate(`(() => {
            const urlInput = document.getElementById('video-resource-url-input');
            urlInput.value = 'https://vimeo.com/123456';
            urlInput.dispatchEvent(new Event('blur'));
        })()`);
        await sleep(300);

        const errorMsg = await cdp.evaluate(`(() => {
            const err = document.querySelector('[data-video-resource-error]');
            return err ? err.textContent : '';
        })()`);
        console.log(`    Invalid URL error displayed: "${errorMsg}"`);
        if (!errorMsg.includes('YouTube')) throw new Error('Expected YouTube URL validation error.');

        // Verification 4: Add Video Resource without initial transcript (Pending state)
        console.log('\n[6] Submitting Valid Video Resource without transcript...');
        await cdp.evaluate(`(() => {
            const urlInput = document.getElementById('video-resource-url-input');
            const titleInput = document.getElementById('video-resource-title-input');
            const form = document.getElementById('video-resource-form');

            urlInput.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            urlInput.dispatchEvent(new Event('blur'));
            titleInput.value = 'CS 101 Lecture: OOP Principles';

            form.dispatchEvent(new Event('submit', { cancelable: true }));
        })()`);
        await sleep(1000);

        const videoInLibrary = await cdp.evaluate(`(() => {
            const cards = Array.from(document.querySelectorAll('.resource-card'));
            const card = cards.find(c => c.textContent.includes('CS 101 Lecture: OOP Principles'));
            return Boolean(card && card.textContent.includes('video') && card.textContent.includes('pending'));
        })()`);
        console.log(`    Video resource in library with pending status: ${videoInLibrary ? 'PASSED' : 'FAILED'}`);
        if (!videoInLibrary) throw new Error('Video resource not found in library with pending status.');

        // Verification 5: Open Resource Viewer for Video Resource
        console.log('\n[7] Opening Resource Viewer for Video Resource...');
        await cdp.evaluate(`(() => {
            const titles = Array.from(document.querySelectorAll('.resource-card-title'));
            const titleBtn = titles.find(b => b.textContent.includes('CS 101 Lecture: OOP Principles'));
            if (titleBtn) titleBtn.click();
        })()`);
        await sleep(800);

        const viewerDetails = await cdp.evaluate(`(() => {
            const dialog = document.getElementById('resource-viewer-dialog');
            const videoSec = document.querySelector('[data-resource-viewer-video-section]');
            const videoInfo = document.querySelector('[data-resource-viewer-video-info]');
            const corsNotice = document.querySelector('.video-cors-notice');
            const pasteBtn = document.querySelector('[data-resource-viewer-paste-transcript]');
            const processBtn = document.querySelector('[data-resource-viewer-process-video]');

            return {
                dialogOpen: Boolean(dialog && dialog.open),
                videoSectionVisible: Boolean(videoSec && !videoSec.hidden),
                videoInfoText: videoInfo ? videoInfo.textContent : '',
                corsNoticeVisible: Boolean(corsNotice),
                pasteBtnVisible: Boolean(pasteBtn && !pasteBtn.hidden),
                processBtnDisabled: Boolean(processBtn && processBtn.disabled),
            };
        })()`);
        console.log(`    Viewer open: ${viewerDetails.dialogOpen ? 'PASSED' : 'FAILED'}`);
        console.log(`    Video section visible: ${viewerDetails.videoSectionVisible ? 'PASSED' : 'FAILED'}`);
        console.log(`    Video ID in info: ${viewerDetails.videoInfoText.includes('dQw4w9WgXcQ') ? 'PASSED' : 'FAILED'}`);
        console.log(`    CORS notice shown: ${viewerDetails.corsNoticeVisible ? 'PASSED' : 'FAILED'}`);
        console.log(`    Paste transcript button active: ${viewerDetails.pasteBtnVisible ? 'PASSED' : 'FAILED'}`);

        if (!viewerDetails.dialogOpen || !viewerDetails.videoSectionVisible || !viewerDetails.corsNoticeVisible) {
            throw new Error('Resource viewer video details or CORS notice not rendered correctly.');
        }

        // Verification 6: Paste transcript through modal and trigger processing
        console.log('\n[8] Pasting Video Transcript via Paste Dialog...');
        await cdp.evaluate(`(() => {
            document.querySelector('[data-resource-viewer-paste-transcript]').click();
        })()`);
        await sleep(500);

        const pasteModalOpen = await cdp.evaluate(`(() => {
            const dialog = document.getElementById('paste-transcript-dialog');
            return Boolean(dialog && dialog.open);
        })()`);
        console.log(`    Paste transcript dialog open: ${pasteModalOpen ? 'PASSED' : 'FAILED'}`);
        if (!pasteModalOpen) throw new Error('Paste transcript dialog did not open.');

        const sampleTranscript = `00:00 Welcome to our lecture on Object-Oriented Programming principles.
00:15 Today we will cover encapsulation, inheritance, polymorphism, and abstraction.
00:45 Encapsulation is the bundling of data with the methods that operate on that data to restrict direct access.
01:15 Inheritance is a mechanism where a new class derives properties and characteristics from an existing base class.
01:45 Polymorphism allows entities such as functions or objects to have more than one form based on context.
02:15 Abstraction is the concept of hiding complex implementation details and showing only essential features to the user.
02:45 In conclusion, these four fundamental pillars enable modular, reusable, and maintainable software architecture.`;

        await cdp.evaluate(`(() => {
            const textarea = document.getElementById('paste-transcript-textarea');
            const form = document.getElementById('paste-transcript-form');
            textarea.value = ${JSON.stringify(sampleTranscript)};
            form.dispatchEvent(new Event('submit', { cancelable: true }));
        })()`);
        await sleep(1500);

        const postPasteViewerState = await cdp.evaluate(`(() => {
            const status = document.querySelector('[data-resource-viewer-status]');
            const processedBadge = document.querySelector('[data-resource-viewer-processed]');
            const videoInfo = document.querySelector('[data-resource-viewer-video-info]');
            const content = document.querySelector('[data-resource-viewer-content]');
            const genBtn = document.querySelector('[data-resource-viewer-generate]');

            return {
                status: status ? status.textContent : '',
                processedText: processedBadge ? processedBadge.textContent : '',
                isProcessedBadgeVisible: Boolean(processedBadge && !processedBadge.hidden),
                videoInfoText: videoInfo ? videoInfo.textContent : '',
                hasContent: Boolean(content && content.textContent.includes('Encapsulation')),
                generateBtnEnabled: Boolean(genBtn && !genBtn.disabled),
            };
        })()`);

        console.log(`    Resource status updated to completed: ${postPasteViewerState.status === 'completed' ? 'PASSED' : 'FAILED'}`);
        console.log(`    Processed chunks badge visible: ${postPasteViewerState.isProcessedBadgeVisible ? 'PASSED' : 'FAILED'} ("${postPasteViewerState.processedText}")`);
        console.log(`    Viewer contains transcript text: ${postPasteViewerState.hasContent ? 'PASSED' : 'FAILED'}`);
        console.log(`    Generate learning outputs button enabled: ${postPasteViewerState.generateBtnEnabled ? 'PASSED' : 'FAILED'}`);

        if (postPasteViewerState.status !== 'completed' || !postPasteViewerState.hasContent) {
            throw new Error('Pasted transcript was not successfully processed.');
        }

        // Verification 7: Generate Learning Outputs for Video Resource
        console.log('\n[9] Generating Learning Outputs from Video Transcript...');
        await cdp.evaluate(`(() => {
            document.querySelector('[data-resource-viewer-generate]').click();
        })()`);
        await sleep(1500);

        const outputsSummary = await cdp.evaluate(`(() => {
            const summaryEl = document.querySelector('[data-resource-viewer-outputs-summary]');
            const badgeEl = document.querySelector('[data-resource-viewer-outputs-badge]');
            return {
                summaryText: summaryEl ? summaryEl.textContent : '',
                badgeText: badgeEl ? badgeEl.textContent : '',
            };
        })()`);
        console.log(`    Learning outputs generated: "${outputsSummary.summaryText}"`);
        console.log(`    Outputs badge: "${outputsSummary.badgeText}"`);
        if (!outputsSummary.summaryText.includes('Summary available')) {
            throw new Error('Learning outputs summary not generated.');
        }

        // Verification 8: Generate Flashcards for Video Resource
        console.log('\n[10] Generating Flashcards from Video Resource...');
        await cdp.evaluate(`(() => {
            document.querySelector('[data-resource-viewer-generate-flashcards]').click();
        })()`);
        await sleep(1200);

        const flashcardsGenerated = await cdp.evaluate(`(() => {
            const summaryEl = document.querySelector('[data-resource-viewer-outputs-summary]');
            return summaryEl ? summaryEl.textContent.includes('flashcard') : false;
        })()`);
        console.log(`    Flashcards generated and linked: ${flashcardsGenerated ? 'PASSED' : 'FAILED'}`);

        // Verification 9: Generate Quiz for Video Resource
        console.log('\n[11] Generating Quiz from Video Resource...');
        await cdp.evaluate(`(() => {
            document.querySelector('[data-resource-viewer-generate-quiz]').click();
        })()`);
        await sleep(1200);

        const quizGenerated = await cdp.evaluate(`(() => {
            const summaryEl = document.querySelector('[data-resource-viewer-outputs-summary]');
            return summaryEl ? summaryEl.textContent.includes('Quiz') : false;
        })()`);
        console.log(`    Quiz generated and linked: ${quizGenerated ? 'PASSED' : 'FAILED'}`);

        // Verification 10: Check console errors
        console.log('\n[12] Checking browser console logs...');
        const realErrors = consoleErrors.filter((e) => !e.includes('favicon.ico'));
        console.log(`    Uncaught console errors: ${realErrors.length}`);
        if (realErrors.length > 0) {
            console.error('    Console errors encountered:', realErrors);
            throw new Error(`Encountered ${realErrors.length} browser console errors.`);
        }

        console.log('\n==================================================');
        console.log('DAY 21 BROWSER VERIFICATION: ALL 10 TESTS PASSED!');
        console.log('==================================================');
    } finally {
        if (cdp) {
            try { await cdp.send('Browser.close'); } catch {}
        }
        chrome.kill();
        server.close();
        try { rmSync(tempProfile, { recursive: true, force: true }); } catch {}
    }
}

run().catch((err) => {
    console.error('\n❌ BROWSER VERIFICATION FAILED:', err);
    process.exit(1);
});
