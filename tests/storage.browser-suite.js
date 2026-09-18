import { DatabaseConnection } from '../js/storage/indexedDB.js';
import { ResourceRepository } from '../js/storage/resourceStore.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function expectRejected(action, expectedCode) {
    try {
        await action();
    } catch (error) {
        assert(error.code === expectedCode, 'Expected error code ' + expectedCode + ', received ' + error.code + '.');
        return;
    }

    throw new Error('Expected the action to reject.');
}

function deleteTestDatabase(indexedDBFactory, databaseName) {
    return new Promise((resolve, reject) => {
        const request = indexedDBFactory.deleteDatabase(databaseName);
        request.addEventListener('success', () => resolve());
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('blocked', () => reject(new Error('The temporary test database is blocked.')));
    });
}

export async function runStorageBrowserSuite() {
    if (!globalThis.indexedDB) {
        throw new Error('Native IndexedDB is unavailable in this browser.');
    }

    const databaseName = 'StudyLensDB-Day3Test-' + globalThis.crypto.randomUUID();
    const timestamps = [
        '2026-09-18T00:00:00.000Z',
        '2026-09-18T00:01:00.000Z',
    ];
    let idCounter = 0;
    const connection = new DatabaseConnection({ databaseName });
    const repository = new ResourceRepository({
        database: connection,
        idGenerator: () => 'resource-' + (++idCounter),
        clock: () => new Date(timestamps.shift() ?? '2026-09-18T00:02:00.000Z'),
    });
    const results = [];

    try {
        const database = await connection.open();
        assert(database.objectStoreNames.contains('resources'), 'The resources store was not created.');
        const resourceStore = database.transaction('resources', 'readonly').objectStore('resources');
        ['type', 'createdAt', 'updatedAt', 'status'].forEach((index) => {
            assert(resourceStore.indexNames.contains(index), 'Missing resources index: ' + index + '.');
        });
        results.push('Database schema and indexes created');

        const created = await repository.createResource({
            title: 'Storage test resource',
            type: 'text',
            source: 'manual://storage-test',
            content: 'Temporary test content',
            tags: ['test'],
            metadata: { temporary: true },
        });
        assert(created.id === 'resource-1', 'Created resource id did not match.');
        results.push('Create and read');

        const read = await repository.getResource(created.id);
        assert(read?.title === 'Storage test resource', 'Resource could not be read by id.');
        assert((await repository.getAllResources()).length === 1, 'Read-all did not return the resource.');
        assert((await repository.getResourcesByType('text')).length === 1, 'Type index did not return the resource.');

        const updated = await repository.updateResource(created.id, {
            title: 'Updated storage test resource',
            status: 'completed',
        });
        assert(updated.title === 'Updated storage test resource', 'Resource title was not updated.');
        assert(updated.status === 'completed', 'Resource status was not updated.');
        assert((await repository.getResourcesByStatus('completed')).length === 1, 'Status index did not return the resource.');
        results.push('Update and indexed reads');

        const duplicateRepository = new ResourceRepository({
            database: connection,
            idGenerator: () => created.id,
            clock: () => new Date('2026-09-18T00:03:00.000Z'),
        });
        await expectRejected(() => duplicateRepository.createResource({
            title: 'Duplicate resource',
            type: 'text',
            source: 'manual://duplicate',
        }), 'DUPLICATE_RESOURCE_ID');

        await expectRejected(() => repository.createResource({
            title: '',
            type: 'text',
            source: 'manual://invalid',
        }), 'INVALID_RESOURCE');
        results.push('Duplicate and validation errors');

        connection.close();
        await connection.open();
        const persisted = await repository.getResource(created.id);
        assert(persisted?.status === 'completed', 'Resource was not available after reopening the database.');
        results.push('Persistence after reopen');

        assert(await repository.deleteResource(created.id), 'Delete did not report success.');
        assert(await repository.getResource(created.id) === null, 'Deleted resource was still available.');
        assert((await repository.clearResources()) === 0, 'Clear did not report the expected empty count.');
        results.push('Delete and clear');
    } finally {
        connection.close();
        await deleteTestDatabase(globalThis.indexedDB, databaseName);
    }

    return results;
}
