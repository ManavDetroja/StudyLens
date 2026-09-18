import { DATABASE_NAME, DATABASE_VERSION, upgradeDatabaseSchema } from './databaseSchema.js';
import { StorageError, asStorageError } from './errors.js';

export class DatabaseConnection {
    constructor({
        databaseName = DATABASE_NAME,
        version = DATABASE_VERSION,
        indexedDBFactory = globalThis.indexedDB,
    } = {}) {
        this.databaseName = databaseName;
        this.version = version;
        this.indexedDBFactory = indexedDBFactory;
        this.database = null;
        this.openPromise = null;
    }

    async open() {
        if (this.database) return this.database;
        if (this.openPromise) return this.openPromise;
        if (!this.indexedDBFactory) {
            throw new StorageError('IndexedDB is not available in this browser.', {
                code: 'INDEXEDDB_UNAVAILABLE',
            });
        }

        this.openPromise = this.openDatabase();

        try {
            this.database = await this.openPromise;
            return this.database;
        } catch (error) {
            this.openPromise = null;
            throw asStorageError(error, 'StudyLens could not open local storage.', 'DATABASE_OPEN_FAILED');
        }
    }

    close() {
        if (this.database) this.database.close();
        this.database = null;
        this.openPromise = null;
    }

    openDatabase() {
        return new Promise((resolve, reject) => {
            let request;
            let settled = false;
            const resolveOnce = (database) => {
                if (settled) {
                    database.close();
                    return;
                }
                settled = true;
                resolve(database);
            };
            const rejectOnce = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            try {
                request = this.indexedDBFactory.open(this.databaseName, this.version);
            } catch (error) {
                rejectOnce(new StorageError('StudyLens could not start the IndexedDB connection.', {
                    code: 'DATABASE_OPEN_FAILED',
                    cause: error,
                }));
                return;
            }

            request.addEventListener('upgradeneeded', (event) => {
                try {
                    upgradeDatabaseSchema(request.result, request.transaction, event.oldVersion);
                } catch (error) {
                    request.transaction.abort();
                    rejectOnce(asStorageError(error, 'StudyLens could not upgrade local storage.', 'DATABASE_MIGRATION_FAILED'));
                }
            });

            request.addEventListener('blocked', () => {
                rejectOnce(new StorageError('StudyLens local storage is blocked by another open tab. Close the other tab and try again.', {
                    code: 'DATABASE_BLOCKED',
                }));
            });

            request.addEventListener('error', () => {
                rejectOnce(new StorageError('StudyLens could not open local storage.', {
                    code: 'DATABASE_OPEN_FAILED',
                    cause: request.error,
                }));
            });

            request.addEventListener('success', () => {
                const database = request.result;
                database.addEventListener('versionchange', () => this.close());
                resolveOnce(database);
            });
        });
    }
}

export const studyLensDatabase = new DatabaseConnection();

export function initializeDatabase() {
    return studyLensDatabase.open();
}
