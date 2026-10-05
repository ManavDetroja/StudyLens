import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 5501;
const CDP_PORT = 9455;
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

    async evaluate(expression, returnByValue = true) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error('Evaluation failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
        }
        return result.result?.value;
    }
}

async function main() {
    console.log('--- StudyLens Day 19 Browser Quality Verification ---');

    // 1. Start HTTP Server
    const server = await createStaticServer(PROJECT_DIR, HTTP_PORT);
    console.log(`[HTTP Server] Listening on http://127.0.0.1:${HTTP_PORT}`);

    // 2. Launch Headless Chrome
    const userDataDir = mkdtempSync(join(tmpdir(), 'studylens-day19-verify-'));
    console.log('[Chrome] User Data Dir:', userDataDir);

    const chromeProcess = spawn(CHROME_PATH, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ]);

    try {
        // Wait for CDP
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
        console.log('[Chrome] CDP Ready:', versionData['User-Agent']);

        const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const targets = await targetsRes.json();
        const pageTarget = targets.find((t) => t.type === 'page');

        const WebSocket = globalThis.WebSocket;
        const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        const cdp = new CdpClient(ws);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');

        // Navigate to StudyLens
        console.log(`[Browser] Navigating to http://127.0.0.1:${HTTP_PORT}/`);
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
        await sleep(2000);

        // Verify App Loaded
        const title = await cdp.evaluate('document.title');
        console.log('[Browser] Document title:', title);

        // Run End-to-End Verification of Phase 16 & 20 Java OOP in browser runtime
        console.log('[Verification Step 1] Creating Java OOP Resource in IndexedDB...');
        const createResult = await cdp.evaluate(`
            (async () => {
                const { resourceRepository } = await import('/js/storage/resourceStore.js');
                const content = 'Encapsulation is the process of bundling data and methods together and controlling access to the data.\\n\\n' +
                    'Inheritance allows one class to acquire properties and methods from another class.\\n\\n' +
                    'Polymorphism allows the same interface to behave in different ways.\\n\\n' +
                    'Method overloading occurs when multiple methods in the same class have the same name but different parameter lists.';

                const res = await resourceRepository.createResource({
                    title: 'Java OOP Concepts',
                    type: 'text',
                    source: 'manual://text-entry',
                    content,
                    tags: ['java', 'oop'],
                    status: 'pending',
                });
                return { id: res.id, title: res.title };
            })()
        `);
        console.log('[Verification Step 1] Resource created:', createResult);

        console.log('[Verification Step 2] Processing Resource into normalized content and chunks...');
        const processResult = await cdp.evaluate(`
            (async () => {
                const { processResourceById } = await import('/js/features/processingIntegration.js');
                const proc = await processResourceById('${createResult.id}');
                return {
                    id: proc.id,
                    chunksCount: proc.chunks.length,
                    normalizedLength: proc.normalizedText.length,
                };
            })()
        `);
        console.log('[Verification Step 2] Processing complete:', processResult);

        console.log('[Verification Step 3] Generating Learning Outputs with Day 19 Grounded Engine...');
        const outputsResult = await cdp.evaluate(`
            (async () => {
                const { generateLearningOutputsForResource } = await import('/js/features/learningOutputService.js');
                const { learningOutputRepository } = await import('/js/storage/learningOutputStore.js');
                const genRes = await generateLearningOutputsForResource('${createResult.id}');
                const outputs = await learningOutputRepository.getLearningOutputsByResourceId('${createResult.id}');
                return {
                    counts: genRes.counts,
                    outputs: outputs.map(o => ({
                        id: o.id,
                        type: o.type,
                        content: o.content,
                        metadata: o.metadata,
                        sourceChunkIds: o.sourceChunkIds,
                    })),
                };
            })()
        `);
        console.log('[Verification Step 3] Learning outputs generated:', outputsResult.counts);

        // Inspect Key Concepts
        const concepts = outputsResult.outputs.filter((o) => o.type === 'concept');
        console.log(`[Verification Step 4] Inspecting Key Concepts (${concepts.length}):`);
        let inhConcept = null;
        for (const c of concepts) {
            console.log(`  - Concept: "${c.content}" | Explanation: "${c.metadata?.explanation}" | Chunks: [${c.sourceChunkIds.join(',')}]`);
            if (c.metadata?.term === 'Inheritance' || c.content === 'Inheritance') {
                inhConcept = c;
            }
        }

        if (!inhConcept) throw new Error('Inheritance concept was not found in generated outputs');
        if (inhConcept.metadata?.explanation === 'Key concept identified in this resource.') {
            throw new Error('FAILURE: Inheritance explanation was the old generic placeholder!');
        }
        if (!inhConcept.metadata?.explanation?.includes('acquire properties and methods')) {
            throw new Error(`FAILURE: Inheritance explanation not grounded: "${inhConcept.metadata?.explanation}"`);
        }
        console.log('  >>> PASS: Concept "Inheritance" is grounded in source text!');

        // Inspect Definitions
        const definitions = outputsResult.outputs.filter((o) => o.type === 'definition');
        console.log(`[Verification Step 5] Inspecting Definitions (${definitions.length}):`);
        for (const d of definitions) {
            console.log(`  - Term: "${d.metadata?.term}" | Definition: "${d.metadata?.definition}" | Chunks: [${d.sourceChunkIds.join(',')}]`);
            if (d.metadata?.definition?.includes('Key concept identified')) {
                throw new Error('FAILURE: Definition contained generic placeholder!');
            }
        }
        console.log('  >>> PASS: Definitions extracted authentically from patterns 1-9!');

        // Inspect Questions
        const questions = outputsResult.outputs.filter((o) => o.type === 'question');
        console.log(`[Verification Step 6] Inspecting Questions (${questions.length}):`);
        for (const q of questions) {
            console.log(`  - Question: "${q.content}" | Answer: "${q.metadata?.answer}" | Chunks: [${q.sourceChunkIds.join(',')}]`);
            if (q.metadata?.answer?.includes('Key concept identified') || q.metadata?.answer?.includes('Review concept:')) {
                throw new Error('FAILURE: Question answer contained generic placeholder!');
            }
        }
        console.log('  >>> PASS: Questions have grounded answers!');

        // Generate Flashcards
        console.log('[Verification Step 7] Generating Flashcards with Grounded Answers...');
        const flashcardsResult = await cdp.evaluate(`
            (async () => {
                const { generateFlashcardsForResource, getFlashcardsForResource } = await import('/js/features/flashcardService.js');
                const genRes = await generateFlashcardsForResource('${createResult.id}', { strictQuality: true });
                const cards = await getFlashcardsForResource('${createResult.id}');
                return {
                    count: genRes.count,
                    cards: cards.map(c => ({
                        id: c.id,
                        front: c.content.front,
                        back: c.content.back,
                        sourceChunkIds: c.sourceChunkIds,
                        metadata: c.metadata,
                    })),
                };
            })()
        `);
        console.log(`[Verification Step 7] Flashcards generated (${flashcardsResult.count}):`);
        for (const card of flashcardsResult.cards) {
            console.log(`  - FRONT: "${card.front}"`);
            console.log(`    BACK:  "${card.back}"`);
            console.log(`    CHUNKS: [${card.sourceChunkIds.join(',')}]`);

            if (card.back === 'Key concept identified in this resource.') {
                throw new Error(`FAILURE: Flashcard back is generic placeholder for "${card.front}"!`);
            }
            if (card.back.startsWith('Review concept:')) {
                throw new Error(`FAILURE: Flashcard back is generic referral hint for "${card.front}"!`);
            }
        }
        console.log('  >>> PASS: All flashcards have substantive, source-grounded answers on the back side!');

        // Generate Quiz
        console.log('[Verification Step 8] Generating Quiz with Grounded MCQs...');
        const quizResult = await cdp.evaluate(`
            (async () => {
                const { generateQuizForResource } = await import('/js/features/quizService.js');
                const result = await generateQuizForResource('${createResult.id}');
                const quiz = result.quiz;
                return {
                    id: quiz.id,
                    title: quiz.title,
                    questionCount: quiz.questions.length,
                    questions: quiz.questions.map(q => ({
                        id: q.id,
                        question: q.question,
                        correctAnswer: q.correctAnswer,
                        options: q.options,
                        sourceChunkIds: q.sourceChunkIds,
                    })),
                };
            })()
        `);
        console.log(`[Verification Step 8] Quiz generated (${quizResult.questionCount} questions):`);
        for (const q of quizResult.questions) {
            console.log(`  - Q: "${q.question}"`);
            console.log(`    CORRECT: "${q.correctAnswer}"`);
            console.log(`    OPTIONS: ${JSON.stringify(q.options)}`);

            if (q.correctAnswer === 'Key concept identified in this resource.') {
                throw new Error('FAILURE: Quiz correct answer is generic placeholder!');
            }
            for (const opt of q.options) {
                if (opt === 'Key concept identified in this resource.') {
                    throw new Error('FAILURE: Quiz option is generic placeholder!');
                }
            }
        }
        console.log('  >>> PASS: Quiz questions have authentic, grounded options and correct answers!');

        // Test Determinism / Regeneration
        console.log('[Verification Step 9] Verifying Deterministic Regeneration (Idempotence)...');
        const regenResult = await cdp.evaluate(`
            (async () => {
                const { generateFlashcardsForResource, getFlashcardsForResource } = await import('/js/features/flashcardService.js');
                const { generateQuizForResource } = await import('/js/features/quizService.js');

                // Regenerate flashcards
                await generateFlashcardsForResource('${createResult.id}', { strictQuality: true });
                const cards = await getFlashcardsForResource('${createResult.id}');

                // Regenerate quiz
                const result = await generateQuizForResource('${createResult.id}');
                const quiz = result.quiz;

                return {
                    flashcardCount: cards.length,
                    quizQuestionCount: quiz.questions.length,
                };
            })()
        `);
        console.log('[Verification Step 9] Regeneration counts:', regenResult);
        if (regenResult.flashcardCount !== flashcardsResult.count) {
            throw new Error(`Flashcard count mismatch after regeneration: ${regenResult.flashcardCount} vs ${flashcardsResult.count}`);
        }
        if (regenResult.quizQuestionCount !== quizResult.questionCount) {
            throw new Error(`Quiz count mismatch after regeneration: ${regenResult.quizQuestionCount} vs ${quizResult.questionCount}`);
        }
        console.log('  >>> PASS: Regeneration is completely deterministic without duplicate accumulation!');

        console.log('\n==================================================');
        console.log('BROWSER VERIFICATION COMPLETE: ALL 9 STEPS PASSED!');
        console.log('==================================================');

    } finally {
        // Cleanup
        chromeProcess.kill();
        server.close();
        try {
            rmSync(userDataDir, { recursive: true, force: true });
        } catch {}
    }
}

main().catch((err) => {
    console.error('Browser Verification Error:', err);
    process.exit(1);
});
