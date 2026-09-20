const DB_NAME = "datasimplr";
const STORE = "active_dataset";
const KEY = "current";

export type StoredDataset = {
  csv: string;
  fileName: string;
  columns: string[];
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no indexedDB"));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set<(d: StoredDataset | null) => void>();

function emit(d: StoredDataset | null) {
  for (const fn of listeners) fn(d);
}

export function subscribeDataset(fn: (d: StoredDataset | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function saveActiveDataset(d: Omit<StoredDataset, "savedAt">) {
  const row: StoredDataset = { ...d, savedAt: Date.now() };
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    try {
      sessionStorage.setItem("ds_dataset_meta", JSON.stringify({ fileName: row.fileName, columns: row.columns, savedAt: row.savedAt }));
    } catch {
      /* ignore quota */
    }
    emit(row);
    return row;
  } catch {
    emit(row);
    return row;
  }
}

export async function loadActiveDataset(): Promise<StoredDataset | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredDataset) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearActiveDataset() {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
  sessionStorage.removeItem("ds_dataset_meta");
  emit(null);
}
