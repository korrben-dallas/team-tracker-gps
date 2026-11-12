// Локальное хранилище точек и участников (IndexedDB) — работает без сети.
const DB_NAME = 'gribnye-tropy';
const DB_VER = 3;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const db = r.result;
      if (e.oldVersion < 1) {
        const pts = db.createObjectStore('points', { keyPath: 'k' });
        pts.createIndex('sent', 'sent');
        pts.createIndex('t', 't');
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (e.oldVersion < 2) {
        // метки находок: общие (priv=0) уходят на сервер, личные (priv=1) — только в телефоне
        db.createObjectStore('marks', { keyPath: 'id' }).createIndex('sent', 'sent');
      }
      if (e.oldVersion < 3) {
        // фрагменты карты для работы без интернета (ключ — адрес фрагмента)
        db.createObjectStore('tiles');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function done(t) {
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}

export async function putMany(store, items) {
  if (!items.length) return;
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  for (const it of items) s.put(it);
  return done(t);
}

export async function getAll(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}

export async function unsent(limit = 500, store = 'points') {
  const db = await open();
  return req(db.transaction(store).objectStore(store).index('sent').getAll(0, limit));
}

export async function get(store, key) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(key));
}

export async function markSent(points, store = 'points') {
  return putMany(store, points.map(p => ({ ...p, sent: 1 })));
}

export async function countUnsent() {
  const db = await open();
  return req(db.transaction('points').objectStore('points').index('sent').count(0));
}

// Удаляет отправленные чужие точки старше olderThan и свои — старше ownOlderThan
export async function prune({ olderThan = 0, ownerId = null, ownOlderThan = 0 } = {}) {
  const db = await open();
  const t = db.transaction('points', 'readwrite');
  const s = t.objectStore('points');
  s.openCursor().onsuccess = e => {
    const c = e.target.result;
    if (!c) return;
    const p = c.value;
    const limit = p.u === ownerId ? ownOlderThan : olderThan;
    if (p.sent === 1 && p.t < limit) c.delete();
    c.continue();
  };
  return done(t);
}

export async function clear(store) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).clear();
  return done(t);
}

// ---- фрагменты карты ----
// храним байты + тип: Blob в IndexedDB на старых iOS бывал ненадёжен
export async function tileGet(key) {
  const db = await open();
  const v = await req(db.transaction('tiles').objectStore('tiles').get(key));
  return v ? new Blob([v.b], { type: v.t }) : null;
}

export async function tileHas(key) {
  const db = await open();
  return (await req(db.transaction('tiles').objectStore('tiles').count(key))) > 0;
}

export async function tilePut(key, blob) {
  const b = await blob.arrayBuffer();
  const db = await open();
  const t = db.transaction('tiles', 'readwrite');
  t.objectStore('tiles').put({ b, t: blob.type || 'image/png' }, key);
  return done(t);
}

export async function tileCount() {
  const db = await open();
  return req(db.transaction('tiles').objectStore('tiles').count());
}
