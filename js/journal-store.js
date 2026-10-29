import { reportError, STORAGE_KEYS } from './storage.js';
import { normalizeSession } from './practice.js';

const RAW_FIELDS = ['hits', 'expected', 'timeline', 'results'];
const requestValue = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const transactionDone = transaction => {
  const result = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Čuvanje dnevnika nije uspelo.'));
  });
  // An IDB request can throw synchronously before its caller reaches await.
  // Keep the transaction failure observed while preserving rejection for await.
  result.catch(() => {}); return result;
};
async function writeTransaction(db, stores, action) {
  const tx = db.transaction(stores, 'readwrite'), done = transactionDone(tx);
  try { action(tx); await done; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
}
export function sessionSummary(session) {
  const result = { ...session, hitCount: session.hits?.length ?? session.hitCount ?? 0, rawStored: true };
  for (const key of RAW_FIELDS) delete result[key];
  return result;
}
const rawRecord = session => Object.fromEntries([['id', session.id], ...RAW_FIELDS.map(key => [key, session[key] || []])]);

export class JournalStore {
  constructor({ name = 'drummer-journal-v2', indexedDB = globalThis.indexedDB, storage = globalThis.localStorage, onFailure = reportError } = {}) {
    this.name = name; this.idb = indexedDB; this.storage = storage; this.onFailure = onFailure;
    this.db = null; this.fallback = false; this.recoveredRestore = false; this.queue = Promise.resolve();
    this.ready = this.initialize();
  }
  async initialize() {
    if (!this.idb) { this.fallback = true; return; }
    try {
      const request = this.idb.open(this.name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const summaries = db.createObjectStore('summaries', { keyPath: 'id' }); summaries.createIndex('startedAt', 'startedAt');
        db.createObjectStore('events', { keyPath: 'id' }); db.createObjectStore('meta', { keyPath: 'key' });
      };
      this.db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Zatvori druge Drummer kartice da bi se dnevnik ažurirao.'));
      });
      this.db.onversionchange = () => this.db.close();
      await this.recoverRestore();
      const legacyText = this.storage?.getItem(STORAGE_KEYS.sessions);
      let legacy = [];
      if (legacyText) {
        try { const parsed = JSON.parse(legacyText); if (Array.isArray(parsed)) legacy = parsed.map(normalizeSession).filter(Boolean); }
        catch (error) { this.onFailure(error, STORAGE_KEYS.sessions); }
      }
      if (legacy.length) {
        // Missing records only: an older retained localStorage backup must never
        // overwrite a more recent committed IndexedDB record on the next load.
        const tx = this.db.transaction(['summaries', 'events'], 'readwrite'), done = transactionDone(tx);
        const summaries = tx.objectStore('summaries'), events = tx.objectStore('events');
        for (const session of legacy) {
          const read = summaries.get(session.id);
          read.onsuccess = () => { if (!read.result) { summaries.put(sessionSummary(session)); events.put(rawRecord(session)); } };
        }
        await done;
        // Deletion follows transaction completion; a crash before this point
        // leaves the old data intact and the migration safely repeatable.
        try { if (this.storage.getItem(STORAGE_KEYS.sessions) === legacyText) this.storage.removeItem(STORAGE_KEYS.sessions); }
        catch (error) { this.onFailure(error, STORAGE_KEYS.sessions); }
      }
    } catch (error) {
      this.onFailure(error, STORAGE_KEYS.sessions);
      // If IDB exists but migration/recovery failed, do not silently switch to a
      // split second database. Keep the original localStorage data for export.
      throw error;
    }
  }
  async recoverRestore() {
    const tx = this.db.transaction('meta', 'readonly'), pending = await requestValue(tx.objectStore('meta').get('restorePending'));
    if (!pending) return;
    const changed = Object.keys(pending.previous).filter(key => this.storage.getItem(key) !== pending.previous[key]);
    for (const key of changed) this.storage.removeItem(key);
    for (const key of changed) if (pending.previous[key] != null) this.storage.setItem(key, pending.previous[key]);
    const clean = this.db.transaction('meta', 'readwrite'), done = transactionDone(clean);
    clean.objectStore('meta').delete('restorePending'); await done;
    this.recoveredRestore = true;
  }
  write(action) {
    const job = this.queue.catch(() => {}).then(() => this.ready).then(action);
    this.queue = job;
    return job.catch(error => { this.onFailure(error, STORAGE_KEYS.sessions); throw error; });
  }
  legacySessions() {
    const value = JSON.parse(this.storage.getItem(STORAGE_KEYS.sessions) || '[]');
    return (Array.isArray(value) ? value : []).map(normalizeSession).filter(Boolean);
  }
  async list() {
    await this.ready; await this.queue.catch(() => {});
    if (this.fallback) return this.legacySessions().map(sessionSummary);
    const records = await requestValue(this.db.transaction('summaries', 'readonly').objectStore('summaries').getAll());
    return records.map(record => {
      const normalized = normalizeSession({ ...record, hits: [] });
      if (!normalized) return null;
      return { ...sessionSummary(normalized), hitCount: Math.max(0, Math.round(Number(record.hitCount) || 0)) };
    }).filter(Boolean);
  }
  async get(id) {
    await this.ready; await this.queue.catch(() => {});
    if (this.fallback) return this.legacySessions().find(s => s.id === id) || null;
    const tx = this.db.transaction(['summaries', 'events'], 'readonly');
    const [summary, raw] = await Promise.all([requestValue(tx.objectStore('summaries').get(id)), requestValue(tx.objectStore('events').get(id))]);
    if (!summary) return null;
    if (!raw) throw new Error('Snimak sesije nije dostupan. Sačuvani sažetak je očuvan.');
    const session = { ...summary, ...raw }; delete session.rawStored; return session;
  }
  put(session) {
    return this.write(async () => {
      if (!session?.id || !Array.isArray(session.hits)) throw new Error('Sesija nema potpun snimak za čuvanje.');
      if (this.fallback) {
        const list = [session, ...this.legacySessions().filter(s => s.id !== session.id)];
        this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(list)); return;
      }
      await writeTransaction(this.db, ['summaries', 'events'], tx => {
        tx.objectStore('summaries').put(sessionSummary(session)); tx.objectStore('events').put(rawRecord(session));
      });
    });
  }
  delete(id) {
    return this.write(async () => {
      if (this.fallback) { this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(this.legacySessions().filter(s => s.id !== id))); return; }
      await writeTransaction(this.db, ['summaries', 'events'], tx => {
        tx.objectStore('summaries').delete(id); tx.objectStore('events').delete(id);
      });
    });
  }
  async exportAll() {
    const summaries = await this.list();
    return Promise.all(summaries.map(s => this.get(s.id)));
  }
  async flush() { await this.ready; await this.queue; return true; }
  restore(sessions, storageValues) {
    return this.write(async () => {
      const previous = Object.fromEntries(Object.keys(storageValues).map(key => [key, this.storage.getItem(key)]));
      const rollback = () => {
        const changed = Object.keys(previous).filter(key => this.storage.getItem(key) !== previous[key]);
        for (const key of changed) this.storage.removeItem(key);
        for (const key of changed) if (previous[key] != null) this.storage.setItem(key, previous[key]);
      };
      if (this.fallback) {
        previous[STORAGE_KEYS.sessions] = this.storage.getItem(STORAGE_KEYS.sessions);
        try {
          for (const [key, value] of Object.entries(storageValues)) this.storage.setItem(key, value);
          this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
        } catch (error) { rollback(); throw error; }
        return;
      }
      // A durable rollback record bridges the localStorage/IDB boundary. On a
      // crash before the final transaction commits, startup restores old keys.
      const prepare = this.db.transaction('meta', 'readwrite'), prepared = transactionDone(prepare);
      prepare.objectStore('meta').put({ key: 'restorePending', previous }); await prepared;
      let transaction;
      try {
        for (const [key, value] of Object.entries(storageValues)) this.storage.setItem(key, value);
        transaction = this.db.transaction(['summaries', 'events', 'meta'], 'readwrite'); const done = transactionDone(transaction);
        const summaries = transaction.objectStore('summaries'), events = transaction.objectStore('events');
        summaries.clear(); events.clear();
        for (const session of sessions) { summaries.put(sessionSummary(session)); events.put(rawRecord(session)); }
        transaction.objectStore('meta').delete('restorePending'); await done;
      } catch (error) {
        try { transaction?.abort(); } catch {}
        rollback();
        const clear = this.db.transaction('meta', 'readwrite'), cleared = transactionDone(clear); clear.objectStore('meta').delete('restorePending'); await cleared;
        throw error;
      }
    });
  }
}
