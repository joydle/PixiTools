/**
 * IndexedDB-backed store for per-build performance snapshots.
 *
 * Each snapshot is ~400 bytes (histogram + percentiles + scores) keyed by
 * an auto-increment id. The `byGameAndTime` compound index supports
 * descending lookups by gameId for "most recent" + "last N" + prune flows.
 * No backend involvement — local browser only.
 */

import type { BuildSnapshot } from './types';
import { SLUG } from '../../brand';

const DB_NAME = `${SLUG}-profiler`;
const DB_VERSION = 1;
const STORE = 'build_snapshots';

export interface SnapshotStore {
  put(snap: BuildSnapshot): Promise<void>;
  getLast(gameId: string): Promise<BuildSnapshot | null>;
  /** Returns the `limit` most recent snapshots for the gameId, newest first. */
  getRecent(gameId: string, limit: number): Promise<BuildSnapshot[]>;
  /** Deletes all but the `keep` most recent snapshots for the gameId. */
  prune(gameId: string, keep: number): Promise<void>;
  /** Closes the underlying IDB connection. App-lifetime singletons usually don't call this; tests do. */
  close(): void;
}

export async function openSnapshotStore(): Promise<SnapshotStore> {
  const db = await openDb();

  return {
    put: (snap) => putSnap(db, snap),
    getLast: async (gameId) => {
      const recent = await getRecentInternal(db, gameId, 1);
      return recent[0] ?? null;
    },
    getRecent: (gameId, limit) => getRecentInternal(db, gameId, limit),
    prune: (gameId, keep) => pruneInternal(db, gameId, keep),
    close: () => db.close(),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('byGameId', 'gameId', { unique: false });
        store.createIndex('byGameAndTime', ['gameId', 'capturedAt'], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putSnap(db: IDBDatabase, snap: BuildSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getRecentInternal(db: IDBDatabase, gameId: string, limit: number): Promise<BuildSnapshot[]> {
  return new Promise((resolve, reject) => {
    const out: BuildSnapshot[] = [];
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('byGameAndTime');
    // Range covering all capturedAt values for this gameId, walked newest-first.
    const range = IDBKeyRange.bound([gameId, 0], [gameId, Number.MAX_SAFE_INTEGER]);
    const req = idx.openCursor(range, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (c && out.length < limit) {
        out.push(c.value as BuildSnapshot);
        c.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function pruneInternal(db: IDBDatabase, gameId: string, keep: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const idx = tx.objectStore(STORE).index('byGameAndTime');
    const range = IDBKeyRange.bound([gameId, 0], [gameId, Number.MAX_SAFE_INTEGER]);
    const req = idx.openCursor(range, 'prev');
    let seen = 0;
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      seen += 1;
      if (seen > keep) {
        c.delete();
      }
      c.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
