import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5500;
const CDP_PORT = 9450;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendCdpCommand(ws, method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = Math.floor(Math.random() * 1000000);
        const msg = JSON.stringify({ id, method, params });
        const onMessage = (data) => {
            const parsed = JSON.parse(data.toString());
            if (parsed.id === id) {
                ws.off('message', onMessage);
                if (parsed.error) {
                    reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
                } else {
                    resolve(parsed.result);
                }
            }
        };
        ws.on('message', onMessage);
        ws.send(msg);
    });
}

async function evalInBrowser(ws, expression, returnByValue = true) {
    const result = await sendCdpCommand(ws, 'Runtime.evaluate', {
        expression,
        returnByValue,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        throw new Error('Evaluation failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    }
    return result.result?.value;
}

async function main() {
    const userDataDir = mkdtempSync(join(tmpdir(), 'studylens-migration-verify-'));
    console.log('[Migration Verify] User Data Dir:', userDataDir);

    const chromeProcess = spawn(CHROME_PATH, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ]);

    try {
        console.log(`[Migration Verify] Waiting for Chrome CDP on port ${CDP_PORT}`);
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
        console.log('[Migration Verify] Chrome ready:', versionData['User-Agent']);

        const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const targets = await targetsRes.json();
        const pageTarget = targets.find(t => t.type === 'page');

        const WebSocket = globalThis.WebSocket;
        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        const pending = new Map();
        let cmdId = 0;
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id && pending.has(data.id)) {
                const { resolve, reject } = pending.get(data.id);
                pending.delete(data.id);
                if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
                else resolve(data.result);
            }
            if (data.method === 'Runtime.consoleAPICalled') {
                const text = data.params.args.map(a => a.value || a.description || '').join(' ');
                if (data.params.type === 'error') {
                    console.error('[Browser Console error]', text);
                } else if (text.includes('Storage Suite') || text.includes('All IndexedDB')) {
                    console.log('[Browser Console log]', text);
                }
            }
        };

        const send = (method, params = {}) => {
            return new Promise((resolve, reject) => {
                const id = ++cmdId;
                pending.set(id, { resolve, reject });
                ws.send(JSON.stringify({ id, method, params }));
            });
        };

        const evaluate = async (expression) => {
            const result = await send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true,
            });
            if (result.exceptionDetails) {
                throw new Error('Evaluation failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
            }
            return result.result?.value;
        };

        const sendCdpCommand = (_ws, method, params) => send(method, params);
        const evalInBrowser = (_ws, expr) => evaluate(expr);

        await send('Page.enable');
        await send('Runtime.enable');

        // ── STEP 1: Run storage.browser.html including migration tests ──
        console.log('\n--- STEP 1: Running storage.browser.html ---');
        await sendCdpCommand(ws, 'Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/tests/storage.browser.html` });
        await sleep(1500);

        const storageResults = await evalInBrowser(ws, `
            (async () => {
                for (let i = 0; i < 30; i++) {
                    const status = document.getElementById('test-status')?.textContent;
                    if (status && !status.includes('Running')) {
                        const items = Array.from(document.querySelectorAll('#test-results li')).map(li => li.textContent);
                        return { status, items };
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                return {
                    status: document.getElementById('test-status')?.textContent,
                    items: Array.from(document.querySelectorAll('#test-results li')).map(li => li.textContent),
                };
            })()
        `);
        console.log('Storage Suite Status:', storageResults?.status);
        console.log('Results item count:', storageResults?.items?.length);
        if (!storageResults?.status?.includes('passed')) {
            throw new Error('storage.browser.html failed: ' + storageResults?.status);
        }

        // ── STEP 2: Simulate the EXACT user problem scenario ──
        // Create an existing "StudyLensDB" database at version 7 that is MISSING notes, quizAttempts, and fileBlobs
        // and has existing user records in resources and learningOutputs.
        console.log('\n--- STEP 2: Seeding pre-existing incomplete database (v7 with existing data) ---');
        const seedResult = await evalInBrowser(ws, `
            (async () => {
                return new Promise((resolve, reject) => {
                    const req = indexedDB.open('StudyLensDB', 7);
                    req.onupgradeneeded = (e) => {
                        const db = req.result;
                        const resStore = db.createObjectStore('resources', { keyPath: 'id' });
                        resStore.createIndex('type', 'type', { unique: false });
                        resStore.createIndex('createdAt', 'createdAt', { unique: false });
                        resStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                        resStore.createIndex('status', 'status', { unique: false });

                        const procStore = db.createObjectStore('processedContent', { keyPath: 'id' });
                        procStore.createIndex('resourceId', 'resourceId', { unique: true });

                        const loStore = db.createObjectStore('learningOutputs', { keyPath: 'id' });
                        loStore.createIndex('resourceId', 'resourceId', { unique: false });
                        loStore.createIndex('type', 'type', { unique: false });
                        loStore.createIndex('createdAt', 'createdAt', { unique: false });

                        const quizStore = db.createObjectStore('quizzes', { keyPath: 'id' });
                        quizStore.createIndex('resourceId', 'resourceId', { unique: false });
                        quizStore.createIndex('createdAt', 'createdAt', { unique: false });
                        // Intentionally OMIT notes, quizAttempts, fileBlobs
                    };
                    req.onsuccess = () => {
                        const db = req.result;
                        const tx = db.transaction(['resources', 'learningOutputs'], 'readwrite');
                        // Add existing resource
                        tx.objectStore('resources').add({
                            id: 'legacy-res-1',
                            title: 'Pre-existing User Document',
                            type: 'text',
                            content: 'Photosynthesis is the process by which green plants make food.',
                            status: 'completed',
                            tags: ['biology'],
                            createdAt: '2026-09-20T10:00:00.000Z',
                            updatedAt: '2026-09-20T10:00:00.000Z',
                        });
                        // Add existing flashcard in learningOutputs
                        tx.objectStore('learningOutputs').add({
                            id: 'output-flash-1',
                            resourceId: 'legacy-res-1',
                            type: 'flashcard',
                            content: { front: 'Photosynthesis', back: 'Process of making food' },
                            sourceChunkIds: [0],
                            createdAt: '2026-09-20T10:05:00.000Z',
                        });
                        tx.oncomplete = () => {
                            const stores = Array.from(db.objectStoreNames);
                            const ver = db.version;
                            db.close();
                            resolve({ version: ver, stores });
                        };
                        tx.onerror = () => reject(tx.error);
                    };
                    req.onerror = () => reject(req.error);
                });
            })()
        `);
        console.log('Seeded database:', seedResult);

        // ── STEP 3: Navigate to StudyLens App and let v8 migration execute automatically ──
        console.log('\n--- STEP 3: Navigating to StudyLens App (triggers v8 upgrade) ---');
        await sendCdpCommand(ws, 'Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
        await sleep(1500);

        // Check storage state on html dataset
        const appStorageState = await evalInBrowser(ws, `
            ({
                storageState: document.documentElement.dataset.storageState,
                resourceStat: document.querySelector('[data-stat="resources"]')?.textContent,
                notesStat: document.querySelector('[data-stat="notes"]')?.textContent,
                quizzesStat: document.querySelector('[data-stat="quizzes"]')?.textContent,
                flashcardsStat: document.querySelector('[data-stat="flashcards"]')?.textContent,
            })
        `);
        console.log('App storage status after boot:', appStorageState);
        if (appStorageState.storageState !== 'ready') {
            throw new Error('Application storage state is not ready! State: ' + appStorageState.storageState);
        }

        // ── STEP 4: Verify ALL 7 stores exist in StudyLensDB ──
        console.log('\n--- STEP 4: Inspecting objectStoreNames in upgraded database ---');
        const dbInspection = await evalInBrowser(ws, `
            (async () => {
                const { studyLensDatabase } = await import('./js/storage/indexedDB.js');
                const db = await studyLensDatabase.open();
                return {
                    version: db.version,
                    stores: Array.from(db.objectStoreNames),
                };
            })()
        `);
        console.log('Upgraded database state:', dbInspection);
        const expectedStores = ['resources', 'processedContent', 'learningOutputs', 'quizzes', 'quizAttempts', 'notes', 'fileBlobs'];
        for (const store of expectedStores) {
            if (!dbInspection.stores.includes(store)) {
                throw new Error('Store still missing after v8 migration: ' + store);
            }
        }
        if (dbInspection.version !== 8) {
            throw new Error('Database version is not 8: ' + dbInspection.version);
        }

        // ── STEP 5: Verify pre-existing user data survived migration ──
        console.log('\n--- STEP 5: Verifying existing user data survived untouched ---');
        const preservedCheck = await evalInBrowser(ws, `
            (async () => {
                const { resourceRepository } = await import('./js/storage/resourceStore.js');
                const { learningOutputRepository } = await import('./js/storage/learningOutputStore.js');
                const res = await resourceRepository.getResource('legacy-res-1');
                const outputs = await learningOutputRepository.getLearningOutputsByResourceId('legacy-res-1');
                return {
                    resourceTitle: res?.title,
                    resourceContent: res?.content,
                    outputsCount: outputs.length,
                    flashcardFront: outputs[0]?.content?.front,
                };
            })()
        `);
        console.log('Preserved user records check:', preservedCheck);
        if (preservedCheck.resourceTitle !== 'Pre-existing User Document') {
            throw new Error('Pre-existing resource was mutated or lost!');
        }
        if (preservedCheck.flashcardFront !== 'Photosynthesis') {
            throw new Error('Pre-existing learning output was mutated or lost!');
        }

        // ── STEP 6: Test Notes Workspace (was previously failing with NotFoundError) ──
        console.log('\n--- STEP 6: Testing Notes Workspace CRUD operations ---');
        const notesTest = await evalInBrowser(ws, `
            (async () => {
                const { createNote, getNote, getAllNotes, updateNote, deleteNote } = await import('./js/features/noteService.js');
                // 1. Create
                const note = await createNote({
                    title: 'Migration Verification Note',
                    content: 'This note tests that the notes store is fully functional after v8 migration.',
                    resourceId: 'legacy-res-1',
                    tags: ['verification', 'storage'],
                });

                // 2. Read
                const retrieved = await getNote(note.id);

                // 3. Read All
                const all = await getAllNotes();

                // 4. Update
                const updated = await updateNote(note.id, {
                    content: 'Updated note content after verification.',
                });

                return {
                    createdId: note.id,
                    retrievedTitle: retrieved.title,
                    allCount: all.length,
                    updatedContent: updated.content,
                };
            })()
        `);
        console.log('Notes Test Result:', notesTest);
        if (notesTest.retrievedTitle !== 'Migration Verification Note') {
            throw new Error('Notes store failed retrieval!');
        }

        // ── STEP 7: Test Quiz Attempts & Analytics (was previously failing with NotFoundError) ──
        console.log('\n--- STEP 7: Testing Quiz Attempts and Analytics ---');
        const quizAttemptTest = await evalInBrowser(ws, `
            (async () => {
                const { recordQuizAttempt, getAttemptsForResource } = await import('./js/features/quizAttemptService.js');
                const { getQuizAnalytics } = await import('./js/features/analyticsService.js');

                const dummyQuiz = {
                    id: 'test-quiz-1',
                    resourceId: 'legacy-res-1',
                    title: 'Legacy Quiz',
                    questions: [
                        { id: 'q-1', question: 'What is photosynthesis?', options: ['A', 'B'], correctAnswer: 'A', sourceChunkIds: [0] },
                        { id: 'q-2', question: 'What is chlorophyll?', options: ['A', 'B'], correctAnswer: 'B', sourceChunkIds: [0] },
                    ],
                };
                const userAnswers = { 'q-1': 'A', 'q-2': 'B' };
                const attempt = await recordQuizAttempt(dummyQuiz, userAnswers);

                // Read attempts
                const attempts = await getAttemptsForResource('legacy-res-1');

                // Read analytics
                const analytics = await getQuizAnalytics();

                return {
                    attemptId: attempt.id,
                    attemptsCount: attempts.length,
                    totalAttempts: analytics.totalAttempts,
                    averageScore: analytics.averageScore,
                };
            })()
        `);
        console.log('Quiz Attempts & Analytics Result:', quizAttemptTest);
        if (quizAttemptTest.attemptsCount !== 1 || quizAttemptTest.averageScore !== 100) {
            throw new Error('Quiz attempts store failed!');
        }

        // ── STEP 8: Test File Blobs (was previously failing with StorageError: fileBlobs unavailable) ──
        console.log('\n--- STEP 8: Testing File Blobs persistence & retrieval ---');
        const fileBlobTest = await evalInBrowser(ws, `
            (async () => {
                const { fileBlobRepository } = await import('./js/storage/fileBlobStore.js');
                const dummyBlob = new Blob(['%PDF-1.4 simulated binary data'], { type: 'application/pdf' });
                await fileBlobRepository.saveFileBlob('legacy-res-1', dummyBlob);

                const retrieved = await fileBlobRepository.getFileBlob('legacy-res-1');
                const text = await retrieved.blob.text();

                return {
                    savedSize: dummyBlob.size,
                    retrievedSize: retrieved.size,
                    mimeType: retrieved.mimeType,
                    blobContent: text,
                };
            })()
        `);
        console.log('File Blobs Test Result:', fileBlobTest);
        if (!fileBlobTest.blobContent.includes('%PDF-1.4')) {
            throw new Error('fileBlobs store failed to store or retrieve blob!');
        }

        // ── STEP 9: Test UI views navigation (Notes, Analytics, Library) ──
        console.log('\n--- STEP 9: Navigating to Notes Page and Analytics Page in UI ---');
        await sendCdpCommand(ws, 'Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/#notes` });
        await sleep(500);
        const notesPageCheck = await evalInBrowser(ws, `
            ({
                noteCards: document.querySelectorAll('.note-card').length,
                firstTitle: document.querySelector('.note-card-title')?.textContent,
            })
        `);
        console.log('Notes page UI check:', notesPageCheck);

        await sendCdpCommand(ws, 'Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/#analytics` });
        await sleep(500);
        const analyticsPageCheck = await evalInBrowser(ws, `
            ({
                totalAttemptsStat: document.querySelector('[data-analytics-total-attempts]')?.textContent,
                averageScoreStat: document.querySelector('[data-analytics-average-score]')?.textContent,
            })
        `);
        console.log('Analytics page UI check:', analyticsPageCheck);

        // ── STEP 10: Refresh browser and confirm all data survives and persists ──
        console.log('\n--- STEP 10: Refreshing browser and confirming full persistence ---');
        await sendCdpCommand(ws, 'Page.reload');
        await sleep(1500);

        const persistenceCheck = await evalInBrowser(ws, `
            (async () => {
                const { resourceRepository } = await import('./js/storage/resourceStore.js');
                const { noteRepository } = await import('./js/storage/noteStore.js');
                const { quizAttemptRepository } = await import('./js/storage/quizAttemptStore.js');
                const { fileBlobRepository } = await import('./js/storage/fileBlobStore.js');

                const res = await resourceRepository.getResource('legacy-res-1');
                const notes = await noteRepository.getAllNotes();
                const attempts = await quizAttemptRepository.getAllAttempts();
                const blob = await fileBlobRepository.getFileBlob('legacy-res-1');

                return {
                    resourceFound: Boolean(res),
                    notesCount: notes.length,
                    attemptsCount: attempts.length,
                    blobFound: Boolean(blob),
                };
            })()
        `);
        console.log('Post-refresh Persistence Check:', persistenceCheck);
        if (!persistenceCheck.resourceFound || persistenceCheck.notesCount !== 1 || persistenceCheck.attemptsCount !== 1 || !persistenceCheck.blobFound) {
            throw new Error('Persistence check failed after browser refresh!');
        }

        console.log('\n========================================');
        console.log('ALL MIGRATION REPAIR VERIFICATION TESTS PASSED PERFECTLY!');
        console.log('========================================\n');

        ws.close();
    } finally {
        chromeProcess.kill('SIGTERM');
        try {
            rmSync(userDataDir, { recursive: true, force: true });
        } catch {}
    }
}

main().catch(err => {
    console.error('[Fatal Error]', err);
    process.exit(1);
});
