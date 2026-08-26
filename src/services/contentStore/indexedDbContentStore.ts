/**
 * IndexedDB media blobs are retired — SD:/perform6-cache is the only store.
 * This stub keeps accidental imports from crashing while remaining a no-op.
 */

export class IndexedDbContentStore {
  async put(): Promise<void> {
    /* no-op */
  }

  async get(): Promise<Blob | null> {
    return null;
  }

  async has(): Promise<boolean> {
    return false;
  }

  async delete(): Promise<void> {
    /* no-op */
  }

  async deleteMany(): Promise<void> {
    /* no-op */
  }

  async listIds(): Promise<string[]> {
    return [];
  }

  async clear(): Promise<void> {
    /* no-op */
  }
}

export const indexedDbContentStore = new IndexedDbContentStore();
