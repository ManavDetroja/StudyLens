import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FILE_IMPORT_CONFIG,
    getResourceTypeFromMime,
    getResourceTypeFromExtension,
    getMimeTypeFromExtension,
    formatFileSize,
} from '../js/features/fileImportConfig.js';

import {
    validateFile,
    getExtension,
    sanitizeFilename,
    deriveTitle,
    validateFileImportInput,
    createFileResourceInput,
} from '../js/features/fileImportValidation.js';

import {
    importFile,
    deleteFileBlob,
    getFileBlob,
} from '../js/features/fileImportService.js';

import { ResourceValidationError } from '../js/storage/errors.js';

// Helper to create a mock File/Blob-like object
function createMockFile(name, size, type) {
    const blob = new Blob([new Uint8Array(Math.min(size, 1024))], { type });
    return {
        name,
        size,
        type,
        slice: (...args) => blob.slice(...args),
    };
}

test('FILE_IMPORT_CONFIG has expected default constraints', () => {
    assert.equal(FILE_IMPORT_CONFIG.maxFileSizeBytes, 50 * 1024 * 1024);
    assert.equal(FILE_IMPORT_CONFIG.maxFileSizeMB, 50);
    assert.ok(FILE_IMPORT_CONFIG.allowedMimeTypes.includes('application/pdf'));
    assert.ok(FILE_IMPORT_CONFIG.allowedMimeTypes.includes('image/jpeg'));
    assert.ok(FILE_IMPORT_CONFIG.allowedMimeTypes.includes('image/png'));
    assert.ok(FILE_IMPORT_CONFIG.allowedMimeTypes.includes('image/webp'));
    assert.ok(FILE_IMPORT_CONFIG.allowedExtensions.includes('.pdf'));
    assert.ok(FILE_IMPORT_CONFIG.allowedExtensions.includes('.png'));
    assert.equal(FILE_IMPORT_CONFIG.titleMaxLength, 160);
});

test('formatFileSize formats bytes, KB, and MB accurately', () => {
    assert.equal(formatFileSize(500), '500 B');
    assert.equal(formatFileSize(1024), '1.0 KB');
    assert.equal(formatFileSize(2048), '2.0 KB');
    assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
    assert.equal(formatFileSize(5.5 * 1024 * 1024), '5.5 MB');
});

test('getResourceTypeFromMime and getResourceTypeFromExtension map accurately', () => {
    assert.equal(getResourceTypeFromMime('application/pdf'), 'pdf');
    assert.equal(getResourceTypeFromMime('image/jpeg'), 'image');
    assert.equal(getResourceTypeFromMime('image/png'), 'image');
    assert.equal(getResourceTypeFromMime('image/webp'), 'image');
    assert.equal(getResourceTypeFromMime('text/plain'), null);
    assert.equal(getResourceTypeFromMime(''), null);

    assert.equal(getResourceTypeFromExtension('.pdf'), 'pdf');
    assert.equal(getResourceTypeFromExtension('.PDF'), 'pdf');
    assert.equal(getResourceTypeFromExtension('.png'), 'image');
    assert.equal(getResourceTypeFromExtension('.jpg'), 'image');
    assert.equal(getResourceTypeFromExtension('.jpeg'), 'image');
    assert.equal(getResourceTypeFromExtension('.webp'), 'image');
    assert.equal(getResourceTypeFromExtension('.docx'), null);
});

test('getMimeTypeFromExtension returns correct MIME strings', () => {
    assert.equal(getMimeTypeFromExtension('.pdf'), 'application/pdf');
    assert.equal(getMimeTypeFromExtension('.jpg'), 'image/jpeg');
    assert.equal(getMimeTypeFromExtension('.jpeg'), 'image/jpeg');
    assert.equal(getMimeTypeFromExtension('.png'), 'image/png');
    assert.equal(getMimeTypeFromExtension('.webp'), 'image/webp');
    assert.equal(getMimeTypeFromExtension('.unknown'), '');
});

test('getExtension extracts lowercase extensions with leading dot', () => {
    assert.equal(getExtension('document.pdf'), '.pdf');
    assert.equal(getExtension('IMAGE.PNG'), '.png');
    assert.equal(getExtension('my.archive.final.JPG'), '.jpg');
    assert.equal(getExtension('noextension'), '');
    assert.equal(getExtension(''), '');
    assert.equal(getExtension(null), '');
});

test('sanitizeFilename removes illegal path characters and controls', () => {
    assert.equal(sanitizeFilename('normal-file.pdf'), 'normal-file.pdf');
    assert.equal(sanitizeFilename('../../etc/passwd.pdf'), '.._.._etc_passwd.pdf');
    assert.equal(sanitizeFilename('my:bad*file<name>.png'), 'my_bad_file_name_.png');
    assert.equal(sanitizeFilename(''), 'Untitled');
    assert.equal(sanitizeFilename(null), 'Untitled');
});

test('deriveTitle removes extension and sanitizes name', () => {
    assert.equal(deriveTitle('Calculus Chapter 1.pdf'), 'Calculus Chapter 1');
    assert.equal(deriveTitle('photo.final.v2.png'), 'photo.final.v2');
    assert.equal(deriveTitle('simple'), 'simple');
    assert.equal(deriveTitle('   '), 'Untitled');
    // Truncates long titles
    const longName = 'A'.repeat(200) + '.pdf';
    assert.equal(deriveTitle(longName).length, 160);
});

test('validateFile rejects non-file inputs', () => {
    assert.throws(() => validateFile(null), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_NO_FILE');
        return true;
    });

    assert.throws(() => validateFile('string'), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_NO_FILE');
        return true;
    });

    assert.throws(() => validateFile({}), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_NO_FILE');
        return true;
    });
});

test('validateFile rejects empty files (size 0)', () => {
    const emptyFile = createMockFile('empty.pdf', 0, 'application/pdf');
    assert.throws(() => validateFile(emptyFile), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_EMPTY_FILE');
        return true;
    });
});

test('validateFile rejects files exceeding size limit', () => {
    const hugeFile = createMockFile('huge.pdf', 51 * 1024 * 1024, 'application/pdf');
    assert.throws(() => validateFile(hugeFile), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_FILE_TOO_LARGE');
        return true;
    });
});

test('validateFile accepts valid PDF and image files', () => {
    const pdfFile = createMockFile('notes.pdf', 1024, 'application/pdf');
    assert.equal(validateFile(pdfFile), pdfFile);

    const pngFile = createMockFile('diagram.png', 2048, 'image/png');
    assert.equal(validateFile(pngFile), pngFile);

    const jpgFile = createMockFile('photo.jpg', 4096, 'image/jpeg');
    assert.equal(validateFile(jpgFile), jpgFile);

    const webpFile = createMockFile('graphic.webp', 1024, 'image/webp');
    assert.equal(validateFile(webpFile), webpFile);
});

test('validateFile rejects unsupported file types', () => {
    const exeFile = createMockFile('virus.exe', 1024, 'application/x-msdownload');
    assert.throws(() => validateFile(exeFile), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_UNSUPPORTED_TYPE');
        return true;
    });

    const txtFile = createMockFile('readme.txt', 1024, 'text/plain');
    assert.throws(() => validateFile(txtFile), (err) => {
        assert.ok(err instanceof ResourceValidationError);
        assert.equal(err.code, 'FILE_IMPORT_UNSUPPORTED_TYPE');
        return true;
    });
});

test('validateFileImportInput validates title and tags', () => {
    const valid = validateFileImportInput({
        title: ' Biology Notes ',
        tags: 'cell, mitosis, cell',
    });
    assert.equal(valid.title, 'Biology Notes');
    assert.deepEqual(valid.tags, ['cell', 'mitosis']);

    assert.throws(() => validateFileImportInput({ title: '   ' }), (err) => {
        assert.equal(err.code, 'FILE_IMPORT_TITLE_REQUIRED');
        return true;
    });

    assert.throws(() => validateFileImportInput({ title: 'A'.repeat(161) }), (err) => {
        assert.equal(err.code, 'FILE_IMPORT_TITLE_TOO_LONG');
        return true;
    });
});

test('createFileResourceInput creates valid Resource record for PDF', () => {
    const file = createMockFile('lecture1.pdf', 12345, 'application/pdf');
    const input = createFileResourceInput(file, {
        title: 'Lecture 1 Slides',
        tags: 'cs101, algorithms',
    });

    assert.equal(input.title, 'Lecture 1 Slides');
    assert.equal(input.type, 'pdf');
    assert.equal(input.source, 'local://file-import');
    assert.equal(input.content, null);
    assert.equal(input.status, 'pending');
    assert.deepEqual(input.tags, ['cs101', 'algorithms']);
    assert.equal(input.metadata.entryMethod, 'file-import');
    assert.equal(input.metadata.originalFileName, 'lecture1.pdf');
    assert.equal(input.metadata.mimeType, 'application/pdf');
    assert.equal(input.metadata.fileSize, 12345);
    assert.equal(input.metadata.extension, '.pdf');
});

test('createFileResourceInput creates valid Resource record for Image', () => {
    const file = createMockFile('diagram.PNG', 67890, 'image/png');
    const input = createFileResourceInput(file, {
        title: 'Cell Diagram',
        tags: 'biology',
    });

    assert.equal(input.title, 'Cell Diagram');
    assert.equal(input.type, 'image');
    assert.equal(input.source, 'local://file-import');
    assert.equal(input.content, null);
    assert.equal(input.status, 'pending');
    assert.deepEqual(input.tags, ['biology']);
    assert.equal(input.metadata.entryMethod, 'file-import');
    assert.equal(input.metadata.originalFileName, 'diagram.PNG');
    assert.equal(input.metadata.mimeType, 'image/png');
    assert.equal(input.metadata.fileSize, 67890);
    assert.equal(input.metadata.extension, '.png');
});

test('importFile creates resource and saves blob atomically', async () => {
    const file = createMockFile('test.pdf', 1024, 'application/pdf');

    const createdResources = [];
    const savedBlobs = [];
    const notifications = [];

    const mockResRepo = {
        async createResource(data) {
            const record = { id: 'res-123', ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            createdResources.push(record);
            return record;
        },
        async deleteResource(id) {
            const index = createdResources.findIndex((r) => r.id === id);
            if (index >= 0) createdResources.splice(index, 1);
            return true;
        },
    };

    const mockBlobRepo = {
        async saveFileBlob(resourceId, blob) {
            savedBlobs.push({ resourceId, blob });
        },
        async deleteFileBlob(resourceId) {
            const index = savedBlobs.findIndex((b) => b.resourceId === resourceId);
            if (index >= 0) savedBlobs.splice(index, 1);
            return true;
        },
    };

    const mockNotify = (event) => {
        notifications.push(event);
    };

    const resource = await importFile(
        file,
        { title: 'My PDF', tags: 'tag1' },
        { resRepo: mockResRepo, blobRepo: mockBlobRepo, notify: mockNotify }
    );

    assert.equal(resource.id, 'res-123');
    assert.equal(resource.title, 'My PDF');
    assert.equal(resource.status, 'pending');
    assert.equal(resource.type, 'pdf');
    assert.equal(createdResources.length, 1);
    assert.equal(savedBlobs.length, 1);
    assert.equal(savedBlobs[0].resourceId, 'res-123');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].action, 'created');
});

test('importFile rolls back resource creation if blob storage fails', async () => {
    const file = createMockFile('fail.pdf', 1024, 'application/pdf');

    const createdResources = [];
    let deleteCalled = false;

    const mockResRepo = {
        async createResource(data) {
            const record = { id: 'res-fail', ...data };
            createdResources.push(record);
            return record;
        },
        async deleteResource(id) {
            deleteCalled = true;
            const index = createdResources.findIndex((r) => r.id === id);
            if (index >= 0) createdResources.splice(index, 1);
            return true;
        },
    };

    const mockBlobRepo = {
        async saveFileBlob() {
            throw new Error('Disk quota exceeded in IndexedDB');
        },
    };

    await assert.rejects(
        () => importFile(
            file,
            { title: 'Fail Test', tags: '' },
            { resRepo: mockResRepo, blobRepo: mockBlobRepo }
        ),
        /Disk quota exceeded/
    );

    assert.ok(deleteCalled, 'deleteResource should have been called during rollback');
    assert.equal(createdResources.length, 0, 'Resource should have been deleted from store');
});

test('deleteFileBlob and getFileBlob delegate to repository', async () => {
    let deletedId = null;
    let fetchedId = null;

    const mockBlobRepo = {
        async deleteFileBlob(id) {
            deletedId = id;
            return true;
        },
        async getFileBlob(id) {
            fetchedId = id;
            return { resourceId: id, mimeType: 'application/pdf' };
        },
    };

    const delResult = await deleteFileBlob('res-999', { blobRepo: mockBlobRepo });
    assert.equal(delResult, true);
    assert.equal(deletedId, 'res-999');

    const getResult = await getFileBlob('res-888', { blobRepo: mockBlobRepo });
    assert.equal(fetchedId, 'res-888');
    assert.equal(getResult.resourceId, 'res-888');
});
