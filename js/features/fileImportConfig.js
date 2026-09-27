export const FILE_IMPORT_CONFIG = Object.freeze({
    maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
    maxFileSizeMB: 50,
    allowedMimeTypes: Object.freeze([
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
    ]),
    allowedExtensions: Object.freeze(['.pdf', '.jpg', '.jpeg', '.png', '.webp']),
    titleMaxLength: 160,
});

export function getResourceTypeFromMime(mimeType) {
    if (!mimeType) return null;
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('image/')) return 'image';
    return null;
}

export function getResourceTypeFromExtension(extension) {
    if (!extension) return null;
    const ext = extension.toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'image';
    return null;
}

export function getMimeTypeFromExtension(extension) {
    if (!extension) return '';
    const ext = extension.toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return '';
}

export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

