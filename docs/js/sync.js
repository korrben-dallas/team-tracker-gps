// Синхронизация с общей базой (Supabase). Всё записывается локально и отправляется,
// как только появляется интернет. С базой приложение общается только через функции (RPC):
// запись подписывается секретом аккаунта, чтение идёт по коду активной группы.
import * as db from './db.js';

const LS_PROFILE_SYNC = 'gt.profileSynced';

export class Sync {
  constructor({ getSettings, getProfile, getGroupId, getPullDays, onPoints, onUsers, onMarks, onGroup, onStatus }) {
    Object.assign(this, { getSettings, getProfile, getGroupId, getPullDays, onPoints, onUsers, onMarks, onGroup, onStatus });
    this.busy = false;
    this.again = false;
    this.lastOk = 0;
    this.lastError = '';
  }

  get configured() {
    const s = this.getSettings();
    return !!(s.supabaseUrl && s.supabaseKey);
  }

  _url() { return this.getSettings().supabaseUrl.trim().replace(/\/+$/, ''); }

  _headers() {
    const key = this.getSettings().supabaseKey.trim();
    const h = { apikey: key, 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key; // старый формат anon JWT
    return h;
  }

  async rpc(fn, args) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(`${this._url()}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: this._headers(), body: JSON.stringify(args || {}),
        signal: ctrl.signal, cache: 'no-store'
      });
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 160)}`);
      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  _auth() { const p = this.getProfile(); return { p_id: p.id, p_secret: p.secret }; }
  _key(name, g = this.getGroupId()) { return `gt.${name}:${this._url()}:${g}`; }

  resetCursor() {
    try {
      for (const k of Object.keys(localStorage)) if (/^gt\.(cursor|mcursor|joined):/.test(k)) localStorage.removeItem(k);
    } catch {}
  }

  forceProfile() {
    try { localStorage.removeItem(LS_PROFILE_SYNC); } catch {}
  }

  async tick() {
    if (this.busy) { this.again = true; return; }
    if (!this.configured) return this.onStatus({ state: 'local' });
    if (!navigator.onLine) return this.onStatus({ state: 'offline' });
    if (!this.getProfile()) return;
    this.busy = true;
    this.onStatus({ state: 'syncing' });
    try {
      await this._pushProfile();
      await this._join();
      await this._pushReports();
      await this._pushPoints();
      await this._pushMarks();
      await this._pullGroup();
      await this._pullUsers();
      await this._pullPoints();
      await this._pullMarks();
      this.lastOk = Date.now();
      this.lastError = '';
      this.onStatus({ state: 'ok' });
    } catch (e) {
      this.lastError = e.name === 'AbortError' ? 'нет ответа сервера' : e.message;
      this.onStatus({ state: navigator.onLine ? 'error' : 'offline', error: this.lastError });
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; setTimeout(() => this.tick(), 50); }
    }
  }

  async _pushProfile() {
    const p = this.getProfile();
    const sig = `${this._url()}:${p.id}:${p.updated}`;
    if (localStorage.getItem(LS_PROFILE_SYNC) === sig) return;
    const ok = await this.rpc('save_profile', { ...this._auth(), p_nick: p.nick, p_photo: p.photo || null, p_updated: p.updated });
    if (!ok) throw new Error('сервер отклонил профиль');
    localStorage.setItem(LS_PROFILE_SYNC, sig);
  }

  async _join() {
    const key = this._key('joined');
    if (localStorage.getItem(key)) return;
    if (await this.rpc('join_group', { ...this._auth(), p_group: this.getGroupId() })) localStorage.setItem(key, '1');
  }

  async _pushReports() {
    const q = JSON.parse(localStorage.getItem('gt.reports') || '[]');
    if (!q.length) return;
    await this.rpc('push_reports', { ...this._auth(), p_rows: q });
    localStorage.setItem('gt.reports', '[]');
  }

  async _pushPoints() {
    for (let i = 0; i < 40; i++) {
      const pts = await db.unsent(500);
      if (!pts.length) return;
      await this.rpc('push_points', {
        ...this._auth(),
        p_rows: pts.map(p => ({ track_id: p.tr, group_id: p.g || 'mushroom', lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), t: p.t }))
      });
      await db.markSent(pts);
    }
  }

  async _pushMarks() {
    for (let i = 0; i < 20; i++) {
      const marks = (await db.unsent(20, 'marks')).filter(m => !m.priv);
      if (!marks.length) return;
      await this.rpc('push_marks', {
        ...this._auth(),
        p_rows: marks.map(m => ({
          id: m.id, group_id: m.g || 'mushroom', lat: +m.lat.toFixed(6), lon: +m.lon.toFixed(6), t: m.t,
          kind: m.kind, text: m.text || null, photo: m.photo || null, deleted: !!m.deleted, updated_at: m.updated
        }))
      });
      // помечаем отправленными только те, что не успели изменить за время отправки
      const same = [];
      for (const m of marks) { const cur = await db.get('marks', m.id); if (cur && cur.updated === m.updated) same.push(cur); }
      await db.markSent(same, 'marks');
      if (marks.length < 20) return;
    }
  }

  async _pullGroup() {
    const g = await this.rpc('get_group', { p_group: this.getGroupId() });
    if (g) this.onGroup(g);
  }

  async _pullUsers() {
    const list = await this.rpc('group_members', { p_group: this.getGroupId() }) || [];
    const users = list.map(u => ({ id: u.id, nick: u.nick, photo: u.photo, updated: u.updated_at }));
    await db.putMany('users', users);
    this.onUsers(users, this.getGroupId());
  }

  async _pullPoints() {
    const g = this.getGroupId();
    const key = this._key('cursor', g);
    // небольшой откат курсора: строки параллельных транзакций могли закоммититься позже
    let cursor = Math.max(0, +(localStorage.getItem(key) || 0) - 50);
    const minT = Date.now() - this.getPullDays() * 864e5;
    for (let page = 0; page < 50; page++) {
      const rows = await this.rpc('pull_points', { p_group: g, p_after: cursor, p_min_t: minT }) || [];
      if (!rows.length) break;
      const recs = rows.map(r => ({ k: `${r.track_id}:${r.t}`, u: r.user_id, tr: r.track_id, g, lat: r.lat, lon: r.lon, t: +r.t, sent: 1 }));
      await db.putMany('points', recs);
      if (g === this.getGroupId()) this.onPoints(recs);
      cursor = rows[rows.length - 1].id;
      localStorage.setItem(key, String(cursor));
      if (rows.length < 1000) break;
    }
  }

  async _pullMarks() {
    const g = this.getGroupId();
    const key = this._key('mcursor', g);
    let cursor = Math.max(0, +(localStorage.getItem(key) || 0) - 50);
    for (let page = 0; page < 50; page++) {
      const rows = await this.rpc('pull_marks', { p_group: g, p_after: cursor }) || [];
      if (!rows.length) break;
      const recs = [];
      for (const r of rows) {
        const local = await db.get('marks', r.id);
        // не затираем локальную правку, которая ещё не ушла на сервер
        if (local && local.sent === 0 && local.updated >= r.updated_at) continue;
        recs.push({ id: r.id, u: r.user_id, g, lat: r.lat, lon: r.lon, t: +r.t, kind: r.kind, text: r.text || '',
          photo: r.photo, deleted: r.deleted ? 1 : 0, updated: +r.updated_at, priv: 0, sent: 1 });
      }
      await db.putMany('marks', recs);
      if (g === this.getGroupId()) this.onMarks(recs);
      cursor = rows[rows.length - 1].rev;
      localStorage.setItem(key, String(cursor));
      if (rows.length < 100) break;
    }
  }

  // ---- вызовы по запросу пользователя ----
  getGroup(id) { return this.rpc('get_group', { p_group: id }); }
  createGroup(meta) {
    return this.rpc('create_group', { ...this._auth(), p_name: meta.name, p_description: meta.description || '',
      p_avatar: meta.avatar || null, p_kind: meta.kind, p_settings: meta.settings });
  }
  updateGroup(id, meta) {
    return this.rpc('update_group', { ...this._auth(), p_group: id, p_name: meta.name, p_description: meta.description || '',
      p_avatar: meta.avatar || null, p_kind: meta.kind, p_settings: meta.settings });
  }
  async ensureProfile() { await this._pushProfile(); }
  leaveGroup(id) { return this.rpc('leave_group', { ...this._auth(), p_group: id }); }
  fetchRatings() { return this.rpc('group_ratings', { p_group: this.getGroupId() }); }
  deleteAccount() { return this.rpc('delete_account', this._auth()); }
}
