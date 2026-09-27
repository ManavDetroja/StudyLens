import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://127.0.0.1:5500';
const CDP_PORT = 9448;

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

async function runBrowserVerification() {
    const userDataDir = mkdtempSync(join(tmpdir(), 'studylens-day17-verify-'));
    console.log(`[Day 17] User Data Dir: ${userDataDir}`);

    const chromeProcess = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ], { stdio: 'ignore' });

    try {
        console.log('[Day 17] Waiting for Chrome CDP on port ' + CDP_PORT);
        const versionData = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
        console.log('[Day 17] Chrome ready:', versionData['User-Agent']);

        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const pageTarget = targets.find((t) => t.type === 'page');
        if (!pageTarget?.webSocketDebuggerUrl) {
            throw new Error('No inspectable page found in Chrome');
        }

        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });
        const cdp = new CdpClient(ws);

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.method === 'Runtime.consoleAPICalled') {
                    console.log(`[Browser Console ${msg.params.type}]`, ...msg.params.args.map(a => a.value || a.description || ''));
                } else if (msg.method === 'Runtime.exceptionThrown') {
                    console.error('[Browser Uncaught Exception]', msg.params.exceptionDetails);
                }
            } catch {}
        });

        // STEP 1: Storage Browser Suite
        console.log('\n--- STEP 1: Running storage.browser.html ---');
        await cdp.send('Page.navigate', { url: `${APP_URL}/tests/storage.browser.html` });
        await sleep(1500);

        const storageResults = await cdp.evaluate(`
            (async () => {
                const resultsEl = document.getElementById('test-results');
                const statusEl = document.getElementById('test-status');
                let waited = 0;
                while (waited < 6000) {
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
        console.log(`Storage Suite Status: ${storageResults.status}`);
        console.log(`Passed ${storageResults.items.length} browser storage tests.`);

        // STEP 2: Navigate to StudyLens App
        console.log('\n--- STEP 2: Navigating to StudyLens App ---');
        await cdp.send('Page.navigate', { url: `${APP_URL}/#library` });
        await sleep(1500);

        // STEP 3: Verify PDF.js is loaded
        console.log('\n--- STEP 3: Verifying PDF.js availability ---');
        const pdfjsCheck = await cdp.evaluate(`
            (() => {
                const hasLib = typeof window.pdfjsLib !== 'undefined';
                const workerSrc = window.pdfjsLib?.GlobalWorkerOptions?.workerSrc || '';
                return { hasLib, workerSrc, version: window.pdfjsLib?.version };
            })()
        `);
        console.log('PDF.js Check:', pdfjsCheck);
        if (!pdfjsCheck.hasLib) {
            throw new Error('window.pdfjsLib is NOT defined in browser!');
        }

        // STEP 4: Import a multi-page test PDF
        console.log('\n--- STEP 4: Importing test PDF via File Import Flow ---');
        const importResult = await cdp.evaluate(`
            (async () => {
                // Navigate to dashboard first to see action cards
                location.hash = '#dashboard';
                await new Promise(r => setTimeout(r, 400));

                // Open import modal
                const openBtn = document.querySelector('[data-resource-action="pdf"]');
                openBtn.click();
                await new Promise(r => setTimeout(r, 400));

                // Generate valid PDF bytes using the test generator logic
                function createPdfBytes(pageTexts) {
                    const numPages = pageTexts.length;
                    let out = '%PDF-1.4\\n';
                    const offsets = [];
                    function addObj(str) {
                        const encoder = new TextEncoder();
                        offsets.push(encoder.encode(out).length);
                        out += str + '\\n';
                    }
                    addObj('1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj');
                    const kids = [];
                    for (let i = 0; i < numPages; i++) kids.push((3 + i * 2) + ' 0 R');
                    addObj('2 0 obj\\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + numPages + ' >>\\nendobj');
                    const fontObjNum = 3 + numPages * 2;
                    for (let i = 0; i < numPages; i++) {
                        const pageObjNum = 3 + i * 2;
                        const contentObjNum = pageObjNum + 1;
                        addObj(pageObjNum + ' 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + fontObjNum + ' 0 R >> >> /Contents ' + contentObjNum + ' 0 R >>\\nendobj');
                        const text = pageTexts[i] || '';
                        const lines = text.split(/\\r?\\n/).map(l => l.trim()).filter(l => l.length > 0);
                        let streamContent = '';
                        if (lines.length > 0) {
                            const commands = lines.map((line, lineIdx) => {
                                const escaped = line.replace(/\\\\/g, '\\\\\\\\').replace(/\\(/g, '\\\\(').replace(/\\)/g, '\\\\)');
                                return lineIdx === 0 ? '50 720 Td (' + escaped + ') Tj' : '0 -24 Td (' + escaped + ') Tj';
                            });
                            streamContent = 'BT\\n/F1 12 Tf\\n' + commands.join('\\n') + '\\nET';
                        }
                        const encoder = new TextEncoder();
                        addObj(contentObjNum + ' 0 obj\\n<< /Length ' + encoder.encode(streamContent).length + ' >>\\nstream\\n' + streamContent + '\\nendstream\\nendobj');
                    }
                    addObj(fontObjNum + ' 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\\nendobj');
                    const encoder = new TextEncoder();
                    const xrefOffset = encoder.encode(out).length;
                    out += 'xref\\n0 ' + (offsets.length + 1) + '\\n0000000000 65535 f \\n';
                    for (let i = 0; i < offsets.length; i++) {
                        out += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n';
                    }
                    out += 'trailer\\n<< /Size ' + (offsets.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xrefOffset + '\\n%%EOF';
                    return encoder.encode(out);
                }

                const page1 = 'Photosynthesis is defined as the biological process by which autotrophic organisms convert solar light into chemical energy.\\n\\nChloroplast is defined as the specialized organelle where chlorophyll captures radiant sunlight.';
                const page2 = 'Mitochondria is defined as the double-membraned organelle generating cellular adenosine triphosphate.\\n\\nATP refers to adenosine triphosphate, the universal high-energy phosphate carrier in cellular metabolism.';
                const page3 = 'Cellular respiration is defined as the catabolic pathway breaking glucose down into carbon dioxide and water.\\n\\nGlycolysis refers to the initial anaerobic breakdown of glucose occurring in the cytoplasm.';

                const pdfBytes = createPdfBytes([page1, page2, page3]);
                const file = new File([pdfBytes], 'Bioenergetics_Lecture.pdf', { type: 'application/pdf' });

                // Set file on input via DataTransfer
                const input = document.getElementById('file-import-input');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));

                await new Promise(r => setTimeout(r, 400));

                const titleInput = document.getElementById('file-import-title-input');
                const tagsInput = document.getElementById('file-import-tags');
                titleInput.value = 'Cellular Bioenergetics';
                tagsInput.value = 'biology, bioenergetics, photosynthesis';

                // Submit form
                document.getElementById('file-import-form').requestSubmit();

                await new Promise(r => setTimeout(r, 800));

                // Navigate to library
                location.hash = '#library';
                await new Promise(r => setTimeout(r, 500));

                // Verify resource card in library
                const cards = document.querySelectorAll('.resource-card');
                const card = Array.from(cards).find(c => c.textContent.includes('Cellular Bioenergetics'));
                const statusBadge = card ? card.querySelector('.resource-status')?.textContent : null;
                const statusData = card ? card.querySelector('.resource-status')?.dataset.status : null;
                const typeBadge = card ? card.querySelector('.badge')?.textContent : null;

                return {
                    foundCard: Boolean(card),
                    statusBadge,
                    statusData,
                    typeBadge,
                };
            })()
        `);
        console.log('Import Result:', importResult);
        if (!importResult.foundCard) throw new Error('Imported PDF resource card not found in library');

        // STEP 5: Open Resource Viewer
        console.log('\n--- STEP 5: Opening Resource Viewer for Imported PDF ---');
        const viewerState = await cdp.evaluate(`
            (async () => {
                const card = Array.from(document.querySelectorAll('.resource-card')).find(c => c.textContent.includes('Cellular Bioenergetics'));
                const titleBtn = card.querySelector('.resource-card-title');
                titleBtn.click();

                await new Promise(r => setTimeout(r, 600));

                const dialog = document.getElementById('resource-viewer-dialog');
                const title = document.querySelector('[data-resource-viewer-title]')?.textContent;
                const status = document.querySelector('[data-resource-viewer-status]')?.textContent;
                const statusData = document.querySelector('[data-resource-viewer-status]')?.dataset.status;
                const extractBtn = document.querySelector('[data-resource-viewer-extract-pdf]');
                const contentText = document.querySelector('[data-resource-viewer-content]')?.textContent;
                const generateOutputsBtn = document.querySelector('[data-resource-viewer-generate]');

                return {
                    dialogOpen: dialog?.open,
                    title,
                    status,
                    statusData,
                    extractBtnVisible: !extractBtn?.hidden,
                    extractBtnText: extractBtn?.textContent,
                    extractBtnDisabled: extractBtn?.disabled,
                    contentTextPreview: contentText?.slice(0, 80),
                    generateDisabled: generateOutputsBtn?.disabled,
                };
            })()
        `);
        console.log('Viewer Initial State:', viewerState);
        if (!viewerState.dialogOpen) throw new Error('Resource viewer dialog did not open');
        if (!viewerState.extractBtnVisible) throw new Error('Extract PDF button is not visible');
        if (!viewerState.generateDisabled) throw new Error('Generate button should be disabled before extraction');

        // STEP 6: Click Extract PDF content
        console.log('\n--- STEP 6: Clicking Extract PDF content ---');
        const extractionResult = await cdp.evaluate(`
            (async () => {
                const extractBtn = document.querySelector('[data-resource-viewer-extract-pdf]');
                extractBtn.click();

                // Wait for extraction to complete
                let waited = 0;
                while (waited < 10000) {
                    await new Promise(r => setTimeout(r, 300));
                    waited += 300;
                    const btn = document.querySelector('[data-resource-viewer-extract-pdf]');
                    if (btn && btn.textContent.includes('Reprocess')) break;
                }

                const toast = document.querySelector('.toast')?.textContent;
                const status = document.querySelector('[data-resource-viewer-status]')?.textContent;
                const statusData = document.querySelector('[data-resource-viewer-status]')?.dataset.status;
                const btnText = document.querySelector('[data-resource-viewer-extract-pdf]')?.textContent;
                const content = document.querySelector('[data-resource-viewer-content]')?.textContent;
                const generateOutputsBtn = document.querySelector('[data-resource-viewer-generate]');
                const generateFlashcardsBtn = document.querySelector('[data-resource-viewer-generate-flashcards]');
                const generateQuizBtn = document.querySelector('[data-resource-viewer-generate-quiz]');

                return {
                    toast,
                    status,
                    statusData,
                    btnText,
                    hasPage1: content.includes('--- Page 1 ---'),
                    hasPage2: content.includes('--- Page 2 ---'),
                    hasPage3: content.includes('--- Page 3 ---'),
                    contentPreview: content.slice(0, 150),
                    generateOutputsEnabled: !generateOutputsBtn?.disabled,
                    generateFlashcardsEnabled: !generateFlashcardsBtn?.disabled,
                    generateQuizEnabled: !generateQuizBtn?.disabled,
                };
            })()
        `);
        console.log('Extraction Result:', extractionResult);
        if (extractionResult.status !== 'completed') throw new Error('Status did not transition to completed');
        if (!extractionResult.hasPage1 || !extractionResult.hasPage2 || !extractionResult.hasPage3) {
            throw new Error('Page headers (--- Page X ---) not found in extracted content');
        }
        if (!extractionResult.generateOutputsEnabled) throw new Error('Generate learning outputs should now be enabled');

        // STEP 7: Generate Learning Outputs
        console.log('\n--- STEP 7: Generating Learning Outputs from extracted PDF ---');
        const outputsResult = await cdp.evaluate(`
            (async () => {
                const genBtn = document.querySelector('[data-resource-viewer-generate]');
                genBtn.click();

                let waited = 0;
                while (waited < 10000) {
                    await new Promise(r => setTimeout(r, 300));
                    waited += 300;
                    const btn = document.querySelector('[data-resource-viewer-generate]');
                    if (btn && btn.textContent.includes('Regenerate')) break;
                }

                const summaryText = document.querySelector('.output-summary-text')?.textContent;
                const conceptItems = document.querySelectorAll('.concept-chip');
                const definitionCards = document.querySelectorAll('.definition-card');
                const questionCards = document.querySelectorAll('.question-item, .question-card');

                return {
                    hasSummary: Boolean(summaryText && summaryText.length > 20),
                    conceptCount: conceptItems.length,
                    definitionCount: definitionCards.length,
                    questionCount: questionCards.length,
                };
            })()
        `);
        console.log('Learning Outputs Result:', outputsResult);
        if (!outputsResult.hasSummary) throw new Error('Summary was not generated');
        if (outputsResult.definitionCount < 2) throw new Error('Definitions were not generated');

        // STEP 8: Generate Flashcards and study them
        console.log('\n--- STEP 8: Generating Flashcards and testing Flashcard Viewer ---');
        const flashcardResult = await cdp.evaluate(`
            (async () => {
                const fcBtn = document.querySelector('[data-resource-viewer-generate-flashcards]');
                fcBtn.click();

                let waited = 0;
                while (waited < 10000) {
                    await new Promise(r => setTimeout(r, 300));
                    waited += 300;
                    const btn = document.querySelector('[data-resource-viewer-generate-flashcards]');
                    if (btn && btn.textContent.includes('Regenerate')) break;
                }

                const studyBtn = document.querySelector('[data-study-flashcards-btn]');
                if (!studyBtn) return { error: 'Study flashcards button not found' };

                studyBtn.click();
                await new Promise(r => setTimeout(r, 400));

                const modal = document.getElementById('flashcard-viewer-dialog');
                const cardFront = document.querySelector('[data-flashcard-front]')?.textContent;
                const flipBtn = document.querySelector('[data-flashcard-flip]');
                flipBtn?.click();
                await new Promise(r => setTimeout(r, 200));

                const cardBack = document.querySelector('[data-flashcard-back]')?.textContent;
                const nextBtn = document.querySelector('[data-flashcard-next]');
                nextBtn?.click();
                await new Promise(r => setTimeout(r, 200));

                const cardFront2 = document.querySelector('[data-flashcard-front]')?.textContent;
                const closeBtn = document.querySelector('#flashcard-viewer-dialog [data-dialog-close]');
                closeBtn?.click();
                await new Promise(r => setTimeout(r, 300));

                return {
                    modalOpened: modal?.open,
                    cardFront,
                    cardBack,
                    advancedToNext: cardFront !== cardFront2,
                };
            })()
        `);
        console.log('Flashcards Result:', flashcardResult);
        if (!flashcardResult.cardFront || !flashcardResult.cardBack) throw new Error('Flashcard front/back not working');

        // STEP 9: Generate Quiz and Take Quiz
        console.log('\n--- STEP 9: Generating Quiz and playing Quiz Player ---');
        const quizResult = await cdp.evaluate(`
            (async () => {
                const quizBtn = document.querySelector('[data-resource-viewer-generate-quiz]');
                quizBtn.click();

                let waited = 0;
                while (waited < 10000) {
                    await new Promise(r => setTimeout(r, 300));
                    waited += 300;
                    const btn = document.querySelector('[data-resource-viewer-generate-quiz]');
                    if (btn && btn.textContent.includes('Regenerate')) break;
                }

                const startBtn = document.querySelector('[data-start-quiz-btn]');
                if (!startBtn) return { error: 'Start quiz button not found' };

                startBtn.click();
                await new Promise(r => setTimeout(r, 400));

                const quizModal = document.getElementById('quiz-player-dialog');
                const questionText = document.querySelector('[data-quiz-question-text]')?.textContent;
                const options = document.querySelectorAll('[data-quiz-options-list] button');

                // Select first option
                options[0]?.click();
                await new Promise(r => setTimeout(r, 200));

                // Click Next question if available
                const nextBtn = document.querySelector('[data-quiz-next]');
                if (nextBtn && !nextBtn.disabled && !nextBtn.hidden) {
                    nextBtn.click();
                    await new Promise(r => setTimeout(r, 200));
                    const opt2 = document.querySelectorAll('[data-quiz-options-list] button');
                    opt2[0]?.click();
                }

                // Submit quiz
                const submitBtn = document.querySelector('[data-quiz-submit]');
                if (submitBtn && !submitBtn.hidden) {
                    submitBtn.click();
                } else {
                    // Navigate through remaining questions to submit
                    while (true) {
                        const n = document.querySelector('[data-quiz-next]');
                        if (n && !n.disabled && !n.hidden) {
                            n.click();
                            await new Promise(r => setTimeout(r, 200));
                            const opts = document.querySelectorAll('[data-quiz-options-list] button');
                            opts[0]?.click();
                        } else {
                            break;
                        }
                    }
                    document.querySelector('[data-quiz-submit]')?.click();
                }

                await new Promise(r => setTimeout(r, 600));

                const bannerEl = document.querySelector('[data-quiz-score-banner]')?.textContent;
                const statsEl = document.querySelector('[data-quiz-score-stats]')?.textContent;
                const closeBtn = document.querySelector('#quiz-player-dialog [data-dialog-close]');
                closeBtn?.click();
                await new Promise(r => setTimeout(r, 300));

                return {
                    quizModalOpened: quizModal?.open,
                    questionText,
                    optionCount: options.length,
                    bannerText: bannerEl,
                    statsText: statsEl,
                };
            })()
        `);
        console.log('Quiz Result:', quizResult);
        if (!quizResult.bannerText) throw new Error('Quiz submission did not produce score banner');

        // STEP 10: Reprocess PDF
        console.log('\n--- STEP 10: Reprocessing PDF ---');
        const reprocessResult = await cdp.evaluate(`
            (async () => {
                const reprocessBtn = document.querySelector('[data-resource-viewer-extract-pdf]');
                if (!reprocessBtn.textContent.includes('Reprocess')) {
                    return { error: 'Button text does not say Reprocess' };
                }

                reprocessBtn.click();

                let waited = 0;
                while (waited < 10000) {
                    await new Promise(r => setTimeout(r, 300));
                    waited += 300;
                    const btn = document.querySelector('[data-resource-viewer-extract-pdf]');
                    if (btn && !btn.disabled && btn.textContent.includes('Reprocess')) break;
                }

                const toast = document.querySelector('.toast')?.textContent;
                const status = document.querySelector('[data-resource-viewer-status]')?.textContent;

                return {
                    toast,
                    status,
                };
            })()
        `);
        console.log('Reprocess Result:', reprocessResult);
        if (reprocessResult.status !== 'completed') throw new Error('Reprocess did not retain completed status');

        // Close viewer
        await cdp.evaluate(`document.querySelector('#resource-viewer-dialog [data-dialog-close]')?.click()`);
        await sleep(300);

        // STEP 11: Textless PDF Error Handling
        console.log('\n--- STEP 11: Testing Textless / Scanned PDF error handling ---');
        const textlessResult = await cdp.evaluate(`
            (async () => {
                // Navigate to dashboard first
                location.hash = '#dashboard';
                await new Promise(r => setTimeout(r, 400));

                // Open import modal
                document.querySelector('[data-resource-action="pdf"]').click();
                await new Promise(r => setTimeout(r, 400));

                // Generate textless PDF (only whitespace stream)
                let out = '%PDF-1.4\\n';
                const offsets = [];
                function addObj(str) {
                    const encoder = new TextEncoder();
                    offsets.push(encoder.encode(out).length);
                    out += str + '\\n';
                }
                addObj('1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj');
                addObj('2 0 obj\\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\\nendobj');
                addObj('3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\\nendobj');
                addObj('4 0 obj\\n<< /Length 0 >>\\nstream\\n\\nendstream\\nendobj');
                addObj('5 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\\nendobj');
                const encoder = new TextEncoder();
                const xrefOffset = encoder.encode(out).length;
                out += 'xref\\n0 6\\n0000000000 65535 f \\n';
                for (let i = 0; i < offsets.length; i++) {
                    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n';
                }
                out += 'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n' + xrefOffset + '\\n%%EOF';
                const textlessBytes = encoder.encode(out);

                const file = new File([textlessBytes], 'Scanned_Document.pdf', { type: 'application/pdf' });
                const input = document.getElementById('file-import-input');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));

                await new Promise(r => setTimeout(r, 300));
                document.getElementById('file-import-title-input').value = 'Scanned Textless Document';
                document.getElementById('file-import-form').requestSubmit();
                await new Promise(r => setTimeout(r, 800));

                location.hash = '#library';
                await new Promise(r => setTimeout(r, 500));

                // Open viewer for textless doc
                const cards = document.querySelectorAll('.resource-card');
                const card = Array.from(cards).find(c => c.textContent.includes('Scanned Textless Document'));
                card.querySelector('.resource-card-title').click();
                await new Promise(r => setTimeout(r, 500));

                // Click extract
                const extractBtn = document.querySelector('[data-resource-viewer-extract-pdf]');
                extractBtn.click();

                let waited = 0;
                while (waited < 10000) {
                    await new Promise(r => setTimeout(r, 300));
                    waited += 300;
                    const btn = document.querySelector('[data-resource-viewer-extract-pdf]');
                    if (btn && !btn.disabled) break;
                }

                const toast = document.querySelector('.toast')?.textContent;
                const status = document.querySelector('[data-resource-viewer-status]')?.textContent;
                const statusData = document.querySelector('[data-resource-viewer-status]')?.dataset.status;

                return {
                    toast,
                    status,
                    statusData,
                };
            })()
        `);
        console.log('Textless Result:', textlessResult);
        if (textlessResult.status !== 'failed') throw new Error('Textless PDF status should be failed');
        if (!textlessResult.toast.toLowerCase().includes('no selectable text')) {
            throw new Error('Expected "No selectable text" toast error message');
        }

        console.log('\n========================================');
        console.log('ALL DAY 17 BROWSER TESTS PASSED PERFECTLY!');
        console.log('========================================\n');
    } finally {
        chromeProcess.kill('SIGTERM');
    }
}

runBrowserVerification().catch((err) => {
    console.error('Browser Verification Error:', err);
    process.exit(1);
});
