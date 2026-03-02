export interface StoredSessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  payload: any;
}

const DB_NAME = 'scholartwin_session_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
};

export const saveSessionRecord = async (record: StoredSessionRecord): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB save failed'));
  });
  db.close();
};

export const getSessionRecord = async (id: string): Promise<StoredSessionRecord | null> => {
  const db = await openDb();
  const result = await new Promise<StoredSessionRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as StoredSessionRecord) || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
  });
  db.close();
  return result;
};

export const listSessionRecords = async (): Promise<StoredSessionRecord[]> => {
  const db = await openDb();
  const result = await new Promise<StoredSessionRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as StoredSessionRecord[]) || []);
    req.onerror = () => reject(req.error || new Error('IndexedDB list failed'));
  });
  db.close();
  return result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
};

export const deleteSessionRecord = async (id: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
  });
  db.close();
};
