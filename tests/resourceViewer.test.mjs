import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResourceContent } from '../js/features/resourceViewer.js';

test('resource viewer writes user content as text', () => {
    const contentElement = { textContent: '' };
    const untrustedContent = '<img src=x onerror=alert(1)>Study notes';

    renderResourceContent(contentElement, untrustedContent);

    assert.equal(contentElement.textContent, untrustedContent);
    assert.equal(Object.hasOwn(contentElement, 'innerHTML'), false);
});
