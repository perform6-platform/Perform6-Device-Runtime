const DB_NAME = 'perform6-content-store';
const STORE_NAME = 'media-blobs';
const DB_VERSION = 1;

export interface StoredMediaBlob {
  mediaVersionId: string;
  blob: Blob;
  sizeBytes: number;
  checksum?: string;
  cachedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'mediaVersionId' });
      }
    };
  });
}

class IndexedDbContentStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb();
    }
    return this.dbPromise;
  }

  async put(
    mediaVersionId: string,
    blob: Blob,
    meta: { checksum?: string } = {},
  ): Promise<void> {
    const db = await this.getDb();
    const record: StoredMediaBlob = {
      mediaVersionId,
      blob,
      sizeBytes: blob.size,
      checksum: meta.checksum,
      cachedAt: new Date().toISOString(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB put failed'));
      request.onsuccess = () => resolve();
    });
  }

  async get(mediaVersionId: string): Promise<Blob | null> {
    const db = await this.getDb();
    const record = await new Promise<StoredMediaBlob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(mediaVersionId);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
      request.onsuccess = () => resolve((request.result as StoredMediaBlob | undefined) ?? null);
    });
    return record?.blob ?? null;
  }

  async has(mediaVersionId: string): Promise<boolean> {
    const blob = await this.get(mediaVersionId);
    return blob != null;
  }

  async delete(mediaVersionId: string): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(mediaVersionId);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
      request.onsuccess = () => resolve();
    });
  }

  async deleteMany(mediaVersionIds: string[]): Promise<void> {
    await Promise.all(mediaVersionIds.map((id) => this.delete(id)));
  }

  async listIds(): Promise<string[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error ?? new Error('IndexedDB list failed'));
      request.onsuccess = () => resolve((request.result as string[]) ?? []);
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error ?? new Error('IndexedDB clear failed'));
      request.onsuccess = () => resolve();
    });
  }
}

export const indexedDbContentStore = new IndexedDbContentStore();
