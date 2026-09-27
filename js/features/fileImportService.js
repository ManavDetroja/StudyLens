import { resourceRepository } from '../storage/resourceStore.js';
import { fileBlobRepository } from '../storage/fileBlobStore.js';
import { notifyResourcesChanged } from '../core/resourceEvents.js';
import { validateFile, createFileResourceInput } from './fileImportValidation.js';

/**
 * Import a local file into StudyLens.
 * Creates a resource record and stores the file blob atomically.
 * On blob storage failure, rolls back the resource record.
 *
 * @param {File} file - The selected file
 * @param {{ title: string, tags: string }} formValues - User-edited title and tags
 * @returns {Promise<object>} The created resource record
 */
export async function importFile(
    file,
    formValues,
    {
        resRepo = resourceRepository,
        blobRepo = fileBlobRepository,
        notify = notifyResourcesChanged,
    } = {}
) {
    // 1. Validate the file
    validateFile(file);

    // 2. Build the resource input
    const resourceInput = createFileResourceInput(file, formValues);

    // 3. Create the resource record
    const resource = await resRepo.createResource(resourceInput);

    // 4. Store the file blob, with rollback on failure
    try {
        await blobRepo.saveFileBlob(resource.id, file);
    } catch (blobError) {
        // Rollback: delete the resource record
        try {
            await resRepo.deleteResource(resource.id);
        } catch (rollbackError) {
            console.error('StudyLens could not roll back resource after blob storage failure.', rollbackError);
        }
        throw blobError;
    }

    // 5. Notify listeners
    notify({
        action: 'created',
        resourceId: resource.id,
    });

    return resource;
}

/**
 * Delete the file blob associated with a resource.
 * Non-fatal — callers should catch errors.
 *
 * @param {string} resourceId
 * @returns {Promise<boolean>}
 */
export async function deleteFileBlob(resourceId, { blobRepo = fileBlobRepository } = {}) {
    return blobRepo.deleteFileBlob(resourceId);
}

/**
 * Retrieve the file blob for a resource.
 *
 * @param {string} resourceId
 * @returns {Promise<{resourceId: string, blob: Blob, mimeType: string, size: number, savedAt: string} | null>}
 */
export async function getFileBlob(resourceId, { blobRepo = fileBlobRepository } = {}) {
    return blobRepo.getFileBlob(resourceId);
}
