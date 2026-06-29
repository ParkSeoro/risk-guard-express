// IndexedDB-backed offline action queue.
// Supports two kinds:
//   - "inspection_item" / "inspection_photo": legacy mobile patrol uploads
//   - "rpc": generic Supabase RPC with idempotency_key for safe retries
const DB = "safety-offline";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type QueuedAction = {
  id?: number;
  kind: "inspection_item" | "inspection_photo" | "rpc" | "generic";
  /** Optional client-generated UUID used by `rpc` actions for server-side idempotency. */
  idempotencyKey?: string;
  payload: any;
  createdAt: number;
};

export async function enqueue(action: Omit<QueuedAction, "id" | "createdAt">) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...action, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueue(): Promise<QueuedAction[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as any);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(id: number) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isOnline() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/** RFC4122 v4 UUID — usable as idempotency key without extra deps. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  // Fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
