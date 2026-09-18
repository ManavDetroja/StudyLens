import test from 'node:test';
import { runStorageBrowserSuite } from './storage.browser-suite.js';

test('native IndexedDB resource repository CRUD suite', {
    skip: !globalThis.indexedDB
        ? 'Node does not expose native IndexedDB; run tests/storage.browser.html in a modern browser.'
        : false,
}, async () => {
    await runStorageBrowserSuite();
});
