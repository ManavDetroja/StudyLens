import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5507;
const CDP_PORT = 9461;
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

async function connectCDP(port) {
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json`);
            if (res.ok) {
                const targets = await res.json();
                pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
                if (pageTarget) break;
            }
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    if (!pageTarget) throw new Error('Could not find page target via CDP.');

    const wsUrl = pageTarget.webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.method === 'Runtime.consoleAPICalled') {
            console.log('BROWSER CONSOLE:', data.params.type, data.params.args?.map(a => a.value ?? a.description));
        }
        if (data.id && pending.has(data.id)) {
            const { resolve, reject } = pending.get(data.id);
            pending.delete(data.id);
            if (data.error) reject(data.error);
            else resolve(data.result);
        }
    };

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = msgId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    return { ws, send };
}

async function runBrowserVerification() {
    console.log('--- Starting Day 24 Browser Verification ---');

    const tempProfile = mkdtempSync(join(tmpdir(), 'studylens-d24-'));
    const server = await createStaticServer(PROJECT_DIR, HTTP_PORT);
    console.log(`HTTP Server listening on http://127.0.0.1:${HTTP_PORT}`);

    const chromeProcess = spawn(
        CHROME_PATH,
        [
            '--headless=new',
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${tempProfile}`,
            '--no-first-run',
            '--no-default-browser-check',
            `http://127.0.0.1:${HTTP_PORT}/index.html`,
        ],
        { stdio: 'ignore' }
    );

    let cdp = null;

    try {
        cdp = await connectCDP(CDP_PORT);
        console.log('Connected to Chrome via CDP.');

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        // Helper to evaluate in page
        async function evaluate(expression) {
            const res = await cdp.send('Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true,
            });
            if (res.exceptionDetails) {
                throw new Error('Evaluation error: ' + JSON.stringify(res.exceptionDetails));
            }
            return res.result?.value;
        }

        // Wait for app ready
        console.log('Waiting for app initialization...');
        await evaluate(`
            new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    setTimeout(resolve, 800);
                } else {
                    window.addEventListener('load', () => setTimeout(resolve, 800));
                }
            })
        `);

        // Check storage initialization
        const storageReady = await evaluate(`
            Boolean(window.indexedDB)
        `);
        console.log('Storage available in browser:', storageReady);

        // 1. Create a study-ready resource
        console.log('Creating sample study resource...');
        const createResult = await evaluate(`
            (async () => {
                const { resourceRepository } = await import('./js/storage/resourceStore.js');
                const { generateLearningOutputsForResource } = await import('./js/features/learningOutputService.js');
                const { generateFlashcardsForResource } = await import('./js/features/flashcardService.js');
                const { generateQuizForResource } = await import('./js/features/quizService.js');
                const { processAndStore } = await import('./js/features/processingIntegration.js');

                const content = [
                    "Cellular respiration is a metabolic pathway that breaks down glucose and produces ATP.",
                    "The process consists of glycolysis, the citric acid cycle, and oxidative phosphorylation.",
                    "Glycolysis takes place in the cytoplasm and breaks down glucose into pyruvate.",
                    "The citric acid cycle occurs inside the mitochondrial matrix and releases carbon dioxide.",
                    "Oxidative phosphorylation happens across the mitochondrial inner membrane.",
                    "ATP synthase uses the proton gradient to produce adenosine triphosphate.",
                    "Adenosine triphosphate is the primary energy carrier in all living organisms.",
                    "Aerobic respiration requires oxygen as the final electron acceptor."
                ].join(" ");

                const res = await resourceRepository.createResource({
                    title: "Cellular Respiration Biology Guide",
                    type: "text",
                    source: "manual://text-entry",
                    content,
                    status: "completed",
                    tags: ["biology", "cells", "metabolism"],
                });

                // Process content
                await processAndStore(res);

                // Generate learning materials
                await generateLearningOutputsForResource(res.id);
                await generateFlashcardsForResource(res.id);
                await generateQuizForResource(res.id);

                return res;
            })()
        `);

        console.log('Sample resource created with ID:', createResult.id);

        // 2. Open Resource Viewer and verify Start Session button
        console.log('Opening Resource Viewer...');
        const viewerReady = await evaluate(`
            (async () => {
                const { openResourceViewer } = await import('./js/features/resourceViewer.js');
                await openResourceViewer('${createResult.id}');
                const btn = document.querySelector('[data-resource-viewer-start-session]');
                return {
                    dialogOpen: document.getElementById('resource-viewer-dialog').open,
                    buttonExists: Boolean(btn),
                    buttonDisabled: btn?.disabled,
                };
            })()
        `);
        console.log('Viewer status:', viewerReady);

        if (!viewerReady.dialogOpen || viewerReady.buttonDisabled) {
            throw new Error('Resource viewer did not open or start session button is disabled.');
        }

        // 3. Launch Study Session mode
        console.log('Launching Study Session mode...');
        const sessionLaunch = await evaluate(`
            (async () => {
                const { openStudySession } = await import('./js/features/studySessionUI.js');
                const { closeDialog } = await import('./js/ui/modal.js');
                closeDialog(document.getElementById('resource-viewer-dialog'));
                await openStudySession('${createResult.id}');

                const sessionDialog = document.getElementById('study-session-dialog');
                const stepper = document.querySelector('[data-study-session-stepper]');
                const steps = Array.from(stepper.querySelectorAll('.study-stepper-btn')).map(b => ({
                    id: b.dataset.stepId,
                    label: b.querySelector('.study-stepper-label')?.textContent,
                    disabled: b.disabled,
                    active: b.classList.contains('is-active'),
                }));

                return {
                    dialogOpen: sessionDialog.open,
                    title: document.querySelector('[data-study-session-title]').textContent,
                    timerText: document.querySelector('[data-study-session-timer]').textContent,
                    steps,
                };
            })()
        `);
        console.log('Study Session launch status:', sessionLaunch);

        if (!sessionLaunch.dialogOpen || sessionLaunch.steps.length < 5) {
            throw new Error('Study session dialog did not open with all 5 steps.');
        }

        // 4. Test Step 1: Overview
        console.log('Verifying Overview Step...');
        const overviewCards = await evaluate(`
            Array.from(document.querySelectorAll('[data-study-overview-grid] .study-overview-step-card')).map(c => ({
                title: c.querySelector('.study-overview-step-title')?.textContent,
                desc: c.querySelector('.study-overview-step-desc')?.textContent,
                isAvailable: c.classList.contains('is-available'),
            }))
        `);
        console.log(`Overview rendered ${overviewCards.length} step cards.`);

        // 5. Navigate to Step 2: Outputs
        console.log('Navigating to Learning Outputs step...');
        const outputsStepStatus = await evaluate(`
            (() => {
                document.querySelector('[data-study-session-next]').click();
                const outputsView = document.querySelector('[data-study-view="outputs"]');
                const isHidden = outputsView.hidden;
                const cardCount = outputsView.querySelectorAll('.learning-output-card').length;
                return { isHidden, cardCount };
            })()
        `);
        console.log('Outputs view status:', outputsStepStatus);
        if (outputsStepStatus.isHidden || outputsStepStatus.cardCount === 0) {
            throw new Error('Outputs view is not visible or has no cards.');
        }

        // 6. Navigate to Step 3: Flashcards
        console.log('Navigating to Flashcards step...');
        const flashcardStatus = await evaluate(`
            (() => {
                document.querySelector('[data-study-session-next]').click();
                const fcView = document.querySelector('[data-study-view="flashcards"]');
                const frontText = document.querySelector('[data-study-flashcard-front]').textContent;

                // Flip card
                document.querySelector('[data-study-flashcard-flip]').click();
                const isFlipped = document.querySelector('[data-study-flashcard-card]').classList.contains('is-flipped');
                const backText = document.querySelector('[data-study-flashcard-back]').textContent;

                return {
                    isHidden: fcView.hidden,
                    hasFront: frontText.length > 0,
                    isFlipped,
                    hasBack: backText.length > 0,
                };
            })()
        `);
        console.log('Flashcards study status:', flashcardStatus);
        if (flashcardStatus.isHidden || !flashcardStatus.isFlipped) {
            throw new Error('Flashcards view failed or did not flip properly.');
        }

        // 7. Navigate to Step 4: Quiz
        console.log('Navigating to Quiz step...');
        const quizStatus = await evaluate(`
            (async () => {
                document.querySelector('[data-study-session-next]').click();
                const quizView = document.querySelector('[data-study-view="quiz"]');
                const questionText = document.querySelector('[data-study-quiz-question-text]').textContent;
                const options = Array.from(document.querySelectorAll('[data-study-quiz-options-list] .quiz-option-button'));

                // Select first option
                if (options.length > 0) {
                    options[0].click();
                }

                // If multiple questions, advance through to the last question
                let nextBtn = document.querySelector('[data-study-quiz-next]');
                while (nextBtn && !nextBtn.hidden) {
                    nextBtn.click();
                    const currentOpts = Array.from(document.querySelectorAll('[data-study-quiz-options-list] .quiz-option-button'));
                    if (currentOpts.length > 0) currentOpts[0].click();
                    nextBtn = document.querySelector('[data-study-quiz-next]');
                }

                // Submit quiz
                const submitBtn = document.querySelector('[data-study-quiz-submit]');
                if (submitBtn) {
                    submitBtn.click();
                }

                // Wait for async attempt save
                await new Promise((r) => setTimeout(r, 400));

                const resultsVisible = !document.querySelector('[data-study-quiz-results]').hidden;
                const scoreBanner = document.querySelector('[data-study-quiz-score-banner]').textContent;

                return {
                    isHidden: quizView.hidden,
                    hasQuestion: questionText.length > 0,
                    resultsVisible,
                    scoreBanner,
                };
            })()
        `);
        console.log('Quiz study status:', quizStatus);
        if (quizStatus.isHidden || !quizStatus.resultsVisible) {
            throw new Error('Quiz view failed to submit or show results.');
        }

        // 8. Navigate to Step 5: Summary
        console.log('Navigating to Summary step...');
        const summaryStatus = await evaluate(`
            (async () => {
                document.querySelector('[data-study-session-next]').click();
                await new Promise((r) => setTimeout(r, 400));

                const summaryView = document.querySelector('[data-study-view="summary"]');
                const statBoxes = Array.from(document.querySelectorAll('[data-study-summary-stats-grid] .study-summary-stat-box')).map(b => ({
                    val: b.querySelector('strong')?.textContent,
                    label: b.querySelector('span')?.textContent,
                }));

                const finishBtn = document.querySelector('[data-study-session-finish]');
                const finishVisible = finishBtn && !finishBtn.hidden;

                return {
                    isHidden: summaryView.hidden,
                    statBoxes,
                    finishVisible,
                };
            })()
        `);
        console.log('Summary status:', summaryStatus);
        if (summaryStatus.isHidden || !summaryStatus.finishVisible) {
            throw new Error('Summary view did not show or finish button not visible.');
        }

        // 9. Click Finish / Done
        console.log('Finishing study session...');
        const finishResult = await evaluate(`
            (() => {
                document.querySelector('[data-study-session-finish]').click();
                const sessionDialog = document.getElementById('study-session-dialog');
                return { dialogClosed: !sessionDialog.open };
            })()
        `);
        console.log('Session finished, modal closed:', finishResult.dialogClosed);

        // 10. Re-open Resource Viewer and check Past Study Sessions section
        console.log('Verifying Past Study Sessions rendered in Resource Viewer...');
        const historyCheck = await evaluate(`
            (async () => {
                const { openResourceViewer } = await import('./js/features/resourceViewer.js');
                await openResourceViewer('${createResult.id}');

                const section = document.querySelector('[data-resource-viewer-sessions-section]');
                const badge = document.querySelector('[data-resource-viewer-sessions-badge]');
                const items = Array.from(document.querySelectorAll('[data-resource-viewer-sessions-list] .resource-session-item')).map(item => ({
                    text: item.textContent,
                }));

                return {
                    sectionVisible: !section.hidden,
                    badgeText: badge?.textContent,
                    itemCount: items.length,
                    items,
                };
            })()
        `);
        console.log('Resource Viewer Sessions History:', historyCheck);
        if (!historyCheck.sectionVisible || historyCheck.itemCount === 0) {
            throw new Error('Resource viewer did not render past study sessions.');
        }

        // 11. Directly inspect IndexedDB studySessions store
        console.log('Verifying IndexedDB studySessions store content...');
        const dbSessions = await evaluate(`
            (async () => {
                const { studySessionRepository } = await import('./js/storage/studySessionStore.js');
                const sessions = await studySessionRepository.getSessionsByResource('${createResult.id}');
                return sessions.map(s => ({
                    id: s.id,
                    status: s.status,
                    durationMs: s.durationMs,
                    stepsCompleted: s.stepsCompleted,
                }));
            })()
        `);
        console.log('Persisted IndexedDB sessions:', dbSessions);
        if (dbSessions.length === 0 || dbSessions[0].status !== 'completed') {
            throw new Error('IndexedDB does not contain completed study session record.');
        }

        // 12. Test session abandonment flow
        console.log('Testing session abandonment flow...');
        const abandonCheck = await evaluate(`
            (async () => {
                const { openStudySession } = await import('./js/features/studySessionUI.js');
                const { closeDialog } = await import('./js/ui/modal.js');
                closeDialog(document.getElementById('resource-viewer-dialog'));

                // Start new session
                await openStudySession('${createResult.id}');

                // Click exit button
                document.querySelector('[data-study-session-cancel]').click();
                const exitDialogOpen = document.getElementById('study-session-exit-dialog').open;

                // Confirm exit
                document.querySelector('[data-study-session-confirm-exit]').click();
                await new Promise((r) => setTimeout(r, 300));

                const sessionDialogClosed = !document.getElementById('study-session-dialog').open;
                const { studySessionRepository } = await import('./js/storage/studySessionStore.js');
                const sessions = await studySessionRepository.getSessionsByResource('${createResult.id}');
                const abandoned = sessions.find(s => s.status === 'abandoned');

                return {
                    exitDialogOpen,
                    sessionDialogClosed,
                    abandonedFound: Boolean(abandoned),
                };
            })()
        `);
        console.log('Abandonment test status:', abandonCheck);
        if (!abandonCheck.exitDialogOpen || !abandonCheck.sessionDialogClosed || !abandonCheck.abandonedFound) {
            throw new Error('Session abandonment flow failed.');
        }

        console.log('✅ ALL DAY 24 BROWSER & E2E CHECKS PASSED SUCCESSFULLY!');
    } finally {
        if (cdp?.ws) cdp.ws.close();
        chromeProcess.kill();
        server.close();
        try {
            rmSync(tempProfile, { recursive: true, force: true });
        } catch {
            // temp profile cleanup
        }
    }
}

runBrowserVerification().catch((err) => {
    console.error('Browser verification failed:', err);
    process.exit(1);
});
