import type { EventRecord, ReviewRecord, ScreenshotRecord, SessionRecord } from './types';

// IndexedDB is shared by the service worker (writer for capture data) and the side panel (reviews, reads).
const DB_NAME = 'bugreel';
const DB_VERSION = 1;
type StoreName = 'sessions' | 'events' | 'reviews' | 'screenshots';

let opening: Promise<IDBDatabase> | undefined;

export class StorageError extends Error {
  constructor(message: string, readonly quota = false) { super(message); this.name = 'StorageError'; }
}

function wrap(error: unknown) {
  const name = (error as DOMException | undefined)?.name;
  if (name === 'QuotaExceededError') return new StorageError('Browser storage is full. Delete old BugReel sessions and try again.', true);
  return new StorageError(`Browser storage failed: ${(error as Error | undefined)?.message || name || 'unknown error'}`);
}

export function openDb(): Promise<IDBDatabase> {
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'key', autoIncrement: true }).createIndex('sessionId', 'sessionId');
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'sessionId' });
      if (!db.objectStoreNames.contains('screenshots')) db.createObjectStore('screenshots', { keyPath: 'sessionId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
    request.onerror = () => { opening = undefined; reject(wrap(request.error)); };
    request.onblocked = () => { opening = undefined; reject(new StorageError('Browser storage is blocked by another BugReel window. Close it and retry.')); };
  });
}

async function transaction<T>(stores: StoreName[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, mode); } catch (error) { reject(wrap(error)); return; }
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(wrap(tx.error));
    tx.onabort = () => reject(wrap(tx.error));
    Promise.resolve(run(tx)).then(value => { result = value; }, error => { try { tx.abort(); } catch { /* already finished */ } reject(wrap(error)); });
  });
}

const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const putSession = (session: SessionRecord) => transaction(['sessions'], 'readwrite', tx => { tx.objectStore('sessions').put(session); });
export const getSession = (id: string) => transaction(['sessions'], 'readonly', tx => request<SessionRecord | undefined>(tx.objectStore('sessions').get(id)));
export const listSessions = async () => (await transaction(['sessions'], 'readonly', tx => request<SessionRecord[]>(tx.objectStore('sessions').getAll()))).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
export const countSessions = () => transaction(['sessions'], 'readonly', tx => request<number>(tx.objectStore('sessions').count()));

/** Appends one captured record and updates its session in the same transaction. `update` returns false to
 *  drop the record (for example when a collection limit is reached) while still saving the session change. */
export const appendEvent = (record: EventRecord, update: (session: SessionRecord) => boolean) => transaction(['events', 'sessions'], 'readwrite', async tx => {
  const sessions = tx.objectStore('sessions');
  const session = await request<SessionRecord | undefined>(sessions.get(record.sessionId));
  if (!session) throw new StorageError('The recording session no longer exists.');
  const keep = update(session);
  session.updatedAt = new Date().toISOString();
  sessions.put(session);
  if (keep) tx.objectStore('events').add(record);
  return { session, kept: keep };
});

/** Reads a session, applies an update, and writes it back atomically. */
export const updateSession = (id: string, update: (session: SessionRecord) => void) => transaction(['sessions'], 'readwrite', async tx => {
  const store = tx.objectStore('sessions');
  const session = await request<SessionRecord | undefined>(store.get(id));
  if (!session) return undefined;
  update(session);
  session.updatedAt = new Date().toISOString();
  store.put(session);
  return session;
});

export const getEvents = (sessionId: string) => transaction(['events'], 'readonly', tx => request<EventRecord[]>(tx.objectStore('events').index('sessionId').getAll(sessionId)))
  .then(records => records.sort((a, b) => (a.key ?? 0) - (b.key ?? 0)));

export const getReview = (sessionId: string) => transaction(['reviews'], 'readonly', tx => request<ReviewRecord | undefined>(tx.objectStore('reviews').get(sessionId)));
export const putReview = (review: ReviewRecord) => transaction(['reviews'], 'readwrite', tx => { tx.objectStore('reviews').put(review); });

export const getScreenshot = (sessionId: string) => transaction(['screenshots'], 'readonly', tx => request<ScreenshotRecord | undefined>(tx.objectStore('screenshots').get(sessionId)));
export const putScreenshot = (shot: ScreenshotRecord) => transaction(['screenshots', 'sessions'], 'readwrite', async tx => {
  const sessions = tx.objectStore('sessions');
  const session = await request<SessionRecord | undefined>(sessions.get(shot.sessionId));
  if (!session) throw new StorageError('The recording session no longer exists.');
  tx.objectStore('screenshots').put(shot);
  sessions.put({ ...session, hasScreenshot: true, updatedAt: new Date().toISOString() });
});
export const deleteScreenshot = (sessionId: string) => transaction(['screenshots', 'sessions', 'reviews'], 'readwrite', async tx => {
  tx.objectStore('screenshots').delete(sessionId);
  const session = await request<SessionRecord | undefined>(tx.objectStore('sessions').get(sessionId));
  if (session) tx.objectStore('sessions').put({ ...session, hasScreenshot: false, updatedAt: new Date().toISOString() });
  const review = await request<ReviewRecord | undefined>(tx.objectStore('reviews').get(sessionId));
  if (review) tx.objectStore('reviews').put({ ...review, includeScreenshot: false });
});

/** Removes a session and all of its evidence, review data, and screenshot. */
export const deleteSessionData = (sessionId: string) => transaction(['sessions', 'events', 'reviews', 'screenshots'], 'readwrite', async tx => {
  tx.objectStore('sessions').delete(sessionId);
  tx.objectStore('reviews').delete(sessionId);
  tx.objectStore('screenshots').delete(sessionId);
  const keys = await request<IDBValidKey[]>(tx.objectStore('events').index('sessionId').getAllKeys(sessionId));
  for (const key of keys) tx.objectStore('events').delete(key);
});
