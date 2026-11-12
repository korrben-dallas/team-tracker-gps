/* global L */
// Team Tracker GPS — групповой GPS-трекер.
// Треки участников группы на общей карте: цвет полосы показывает давность (красный → зелёный).
import { DEFAULT_CONFIG } from './config.js';
import * as db from './db.js';
import { TrackLayer, distM, isBreak, setBreakSpeed } from './tracklayer.js';
import { Sync } from './sync.js';
import * as native from './native.js';

const APP_NAME = 'Team Tracker GPS';
const APP_VERSION = '2.2';
const isNative = native.isNative;

const $ = s => document.querySelector(s);
const LS = { profile: 'gt.profile', settings: 'gt.settings', rec: 'gt.rec', view: 'gt.view', tip: 'gt.tipHidden',
  groups: 'gt.groups', reports: 'gt.reports', rating: 'gt.rating' };
const DAY = 864e5;

// ---------- группы-профили ----------
// Три встроенные группы с фиксированными настройками. Остальные группы создают пользователи,
// их настройки задаёт создатель.
const PROFILES = {
  mushroom: {
    id: 'mushroom', builtin: true, kind: 'mushroom', name: 'Грибники', emoji: '🍄', color: '#9c4a1f',
    description: 'Общая карта грибников: видно, где лес уже «прочесали» за последние дни. Через 3 дня трек исчезает — грибы успевают подрасти.',
    settings: { widthM: 7, greenDays: 3, hideDays: 3, minAccuracy: 30, maxSpeed: 7, fadeOld: false }
  },
  search: {
    id: 'search', builtin: true, kind: 'search', name: 'Волонтёры‑поисковики', emoji: '🧭', color: '#e0701b',
    description: 'Карта прочёсывания для поисковых отрядов: широкая полоса показывает осмотренную территорию. Через сутки полоса зеленеет и становится прозрачнее.',
    settings: { widthM: 30, greenDays: 1, hideDays: 14, minAccuracy: 20, maxSpeed: 7, fadeOld: true }
  },
  hike: {
    id: 'hike', builtin: true, kind: 'hike', name: 'Пешие туристы', emoji: '🥾', color: '#2e7d5b',
    description: 'Маршруты пеших туристов за последние 3 месяца: тропы, родники, стоянки и красивые виды.',
    settings: { widthM: 5, greenDays: 30, hideDays: 90, minAccuracy: 20, maxSpeed: 9, fadeOld: false }
  }
};
const TEMPLATE_KINDS = [['mushroom', '🍄', 'Грибы'], ['search', '🧭', 'Поиск'], ['hike', '🥾', 'Туризм'], ['other', '📍', 'Другое']];
const DEFAULT_CUSTOM = { widthM: 10, greenDays: 7, hideDays: 30, minAccuracy: 20, maxSpeed: 7, fadeOld: false };

// виды меток (набор зависит от типа группы)
const KINDS = {
  mushroom: ['🍄', 'Грибы'], spot: ['🧺', 'Грибное место'], berry: ['🫐', 'Ягоды'],
  trace: ['👣', 'След'], item: ['🎒', 'Вещь'], found: ['🙋', 'Найден человек'], checked: ['✅', 'Осмотрено'], hq: ['⛺', 'Штаб'],
  view: ['🏞️', 'Вид'], water: ['💧', 'Вода, родник'], camp: ['🔥', 'Стоянка, привал'], trail: ['🥾', 'Тропа'],
  danger: ['⚠️', 'Опасно'], car: ['🚗', 'Машина'], other: ['📍', 'Другое']
};
const KIND_SETS = {
  mushroom: ['mushroom', 'spot', 'berry', 'danger', 'car', 'camp', 'other'],
  search: ['trace', 'item', 'found', 'checked', 'hq', 'danger', 'car', 'other'],
  hike: ['view', 'water', 'camp', 'trail', 'danger', 'car', 'other'],
  other: ['other', 'danger', 'car', 'camp', 'water', 'view', 'mushroom']
};
const kindOf = k => KINDS[k] || KINDS.other;

const DEFAULTS = {
  group: null,             // активная группа
  myGroups: [],            // созданные и присоединённые группы (коды)
  showPubMarks: true,
  showPrivMarks: true,
  supabaseUrl: DEFAULT_CONFIG.supabaseUrl || '',
  supabaseKey: DEFAULT_CONFIG.supabaseKey || '',
  layer: 'topo',
  hidden: [],
  hiddenMarks: []
};

// Подложки: OpenTopoMap — топографическая карта на данных OpenStreetMap
const LAYERS = {
  topo: { name: 'OSM Topo', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', maxNative: 17,
    attr: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
  sat: { name: 'Спутник', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', sub: '', maxNative: 18,
    attr: 'Снимки © Esri, Maxar, Earthstar Geographics' }
};
const MAX_PREFETCH = 4000;

// ---------- утилиты ----------
const loadJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Не удалось сохранить: ' + e.message); } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safePhoto = p => (typeof p === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)) ? p : null;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
function randomSecret() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}
function hueOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function avatarHtml(u, cls = 'sm') {
  const photo = safePhoto(u?.photo);
  if (photo) return `<span class="avatar ${cls}" style="background-image:url('${photo}')"></span>`;
  const initials = esc(String(u?.nick || '?').trim().slice(0, 2).toUpperCase());
  return `<span class="avatar ${cls}" style="background-color:hsl(${hueOf(u?.id)},45%,38%)">${initials}</span>`;
}
function groupAvatarHtml(g, cls = 'sm') {
  if (!g) return `<span class="avatar ${cls}">?</span>`;
  if (g.builtin) return `<span class="avatar ${cls} gav" style="background-color:${g.color}">${g.emoji}</span>`;
  const photo = safePhoto(g.avatar);
  if (photo) return `<span class="avatar ${cls}" style="background-image:url('${photo}')"></span>`;
  const t = TEMPLATE_KINDS.find(k => k[0] === g.kind) || TEMPLATE_KINDS[3];
  return `<span class="avatar ${cls} gav" style="background-color:hsl(${hueOf(g.id)},40%,35%)">${t[1]}</span>`;
}
function ago(t) {
  const d = Date.now() - t;
  if (d < 60e3) return 'только что';
  if (d < 3600e3) return `${Math.round(d / 60e3)} мин назад`;
  if (d < DAY) return `${Math.round(d / 3600e3)} ч назад`;
  const days = Math.floor(d / DAY);
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
}
function plural(n, a, b, c) { n = Math.abs(Math.round(n)); const m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? b : c; }
const days = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const fmtTime = t => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDist = m => m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} км`;
const fmtDur = ms => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  return (h ? h + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); };
function confirmInline(msg) { try { return window.confirm(msg); } catch { return true; } }

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// фильтр нецензурной лексики для чужих ников и описаний (требование App Store)
const BAD = /(^|[^а-яёa-z])((?:за|вы|на|по|от|у|до|при|раз|об|под)?(?:х[уy][йеёяюи]|пизд|[её]б[аоуиеёл]|бля|муд[аои]к|пид[оа]р|сук[аи]|шлюх|залуп|гандон|fuck|shit|cunt)[а-яёa-z]*)/gi;
const clean = s => String(s ?? '').replace(BAD, (_, pre, w) => pre + w[0] + '*'.repeat(Math.max(1, w.length - 1)));
const hasBad = s => { BAD.lastIndex = 0; const r = BAD.test(String(s)); BAD.lastIndex = 0; return r; };

// ---------- состояние ----------
const settings = Object.assign({}, DEFAULTS, loadJSON(LS.settings, {}));
if (!settings.supabaseUrl && DEFAULT_CONFIG.supabaseUrl) { settings.supabaseUrl = DEFAULT_CONFIG.supabaseUrl; settings.supabaseKey = DEFAULT_CONFIG.supabaseKey; }
for (const k of ['hidden', 'hiddenMarks', 'myGroups']) if (!Array.isArray(settings[k])) settings[k] = [];
const saveSettings = () => saveJSON(LS.settings, settings);

let profile = loadJSON(LS.profile, null);
if (profile && !profile.secret) { profile.secret = randomSecret(); saveJSON(LS.profile, profile); }

const groupCache = loadJSON(LS.groups, {}); // метаданные пользовательских групп (для работы без сети)
const groupById = id => PROFILES[id] || groupCache[id] || null;
const G = () => groupById(settings.group) || PROFILES.mushroom;
const GS = () => ({ ...DEFAULT_CUSTOM, ...(G().settings || {}) });
const isOwner = g => !!(g && !g.builtin && profile && g.owner_id === profile.id);

// model.settings — действующие настройки отображения (из группы) для слоя треков
const model = { tracks: new Map(), users: new Map(), marks: new Map(), settings: {} };
const allUsers = new Map(); // ники и фото всех известных участников (из всех групп)

function applyGroupSettings() {
  Object.assign(model.settings, GS(), { hidden: settings.hidden });
  setBreakSpeed(GS().maxSpeed);
}

function addPoints(points) {
  const dirty = new Set();
  const g = G().id;
  for (const p of points) {
    if ((p.g || 'mushroom') !== g) continue;
    let tr = model.tracks.get(p.tr);
    if (!tr) { tr = { id: p.tr, u: p.u, pts: [] }; model.tracks.set(p.tr, tr); }
    tr.pts.push({ lat: p.lat, lon: p.lon, t: p.t });
    dirty.add(tr);
  }
  for (const tr of dirty) {
    tr.pts.sort((a, b) => a.t - b.t);
    tr.pts = tr.pts.filter((p, i, a) => i === 0 || p.t !== a[i - 1].t);
  }
}

function addMarks(list) {
  const g = G().id;
  for (let m of list) {
    if ((m.g || 'mushroom') !== g) continue;
    if (!profile || m.u !== profile.id) m = { ...m, text: clean(m.text) };
    const old = model.marks.get(m.id);
    if (!old || (m.updated || 0) >= (old.updated || 0)) model.marks.set(m.id, m);
  }
}

function rememberUsers(list) {
  for (let u of list) {
    if (!profile || u.id !== profile.id) u = { ...u, nick: clean(u.nick) };
    const old = allUsers.get(u.id);
    if (!old || (u.updated || 0) >= (old.updated || 0)) allUsers.set(u.id, u);
  }
  if (profile) allUsers.set(profile.id, { id: profile.id, nick: profile.nick, photo: profile.photo, updated: profile.updated });
}

// участники активной группы: члены группы + авторы треков и меток в ней + я
function rebuildGroupUsers() {
  const ids = new Set(loadJSON('gt.members:' + G().id, []));
  for (const tr of model.tracks.values()) ids.add(tr.u);
  for (const m of model.marks.values()) if (!m.priv) ids.add(m.u);
  if (profile) ids.add(profile.id);
  model.users.clear();
  for (const id of ids) model.users.set(id, allUsers.get(id) || { id, nick: 'Участник' });
}

function userLast(uid) {
  let last = null;
  for (const tr of model.tracks.values()) {
    if (tr.u !== uid || !tr.pts.length) continue;
    const p = tr.pts[tr.pts.length - 1];
    if (!last || p.t > last.t) last = p;
  }
  return { last };
}

// загрузить из телефона данные активной группы
async function loadGroupData() {
  model.tracks.clear(); model.marks.clear();
  const [pts, marks] = await Promise.all([db.getAll('points'), db.getAll('marks')]);
  addPoints(pts);
  addMarks(marks);
  rebuildGroupUsers();
}

// ---------- карта ----------
const tileKey = url => url.replace(/^https:\/\/[abc]\./, 'https://');
const inflight = new Map();
async function loadTile(url) {
  const key = tileKey(url);
  const cached = await db.tileGet(key).catch(() => null);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key);
  const p = fetch(url, { mode: 'cors', credentials: 'omit' }).then(async r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    db.tilePut(key, blob).catch(() => {});
    return blob;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
// слой карты, который сам сохраняет фрагменты в телефон и берёт их оттуда без интернета
const CachedTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('role', 'presentation');
    loadTile(this.getTileUrl(coords)).then(blob => {
      const u = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(u); done(null, img); };
      img.onerror = e => { URL.revokeObjectURL(u); done(e, img); };
      img.src = u;
    }).catch(e => done(e, img));
    return img;
  }
});

const view = loadJSON(LS.view, null);
const map = L.map('map', { zoomControl: false, maxZoom: 19, minZoom: 3, worldCopyJump: true, tapTolerance: 20 })
  .setView(view ? [view.lat, view.lng] : [55.75, 37.62], view ? view.z : 9);
map.createPane('tracksPane').style.zIndex = 450;
map.getPane('tracksPane').style.pointerEvents = 'none';
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

const baseLayers = {};
for (const [key, l] of Object.entries(LAYERS)) {
  baseLayers[l.name] = new CachedTileLayer(l.url, {
    subdomains: l.sub || 'abc', maxNativeZoom: l.maxNative, maxZoom: 19, attribution: l.attr, keepBuffer: 4
  });
  baseLayers[l.name]._gtKey = key;
}
const currentLayerKey = () => LAYERS[settings.layer] ? settings.layer : 'topo';
baseLayers[LAYERS[currentLayerKey()].name].addTo(map);
L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', e => { settings.layer = e.layer._gtKey; saveSettings(); });
map.on('moveend', () => { const c = map.getCenter(); saveJSON(LS.view, { lat: c.lat, lng: c.lng, z: map.getZoom() }); });

const trackLayer = new TrackLayer(model).addTo(map);
const marksLayer = L.layerGroup().addTo(map);
const userMarkers = L.layerGroup().addTo(map);
let meMarker = null, meAcc = null;

function refresh() {
  applyGroupSettings();
  renderMarks();
  updateMyScore();
  trackLayer.redraw();
  scheduleMarkers();
  updateLegend();
  renderGroupUi();
}

let markerTimer = null;
function scheduleMarkers() {
  if (markerTimer) return;
  markerTimer = setTimeout(() => { markerTimer = null; renderMarkers(); }, 300);
}
function renderMarkers() {
  userMarkers.clearLayers();
  const hidden = new Set(settings.hidden);
  const minT = Date.now() - Math.min(GS().hideDays, 1) * DAY; // аватарки — по последней точке за сутки
  for (const u of model.users.values()) {
    if ((profile && u.id === profile.id) || hidden.has(u.id)) continue;
    const { last } = userLast(u.id);
    if (!last || last.t < minT) continue;
    const fresh = Date.now() - last.t < 30 * 60e3;
    const icon = L.divIcon({
      className: 'umark' + (fresh ? '' : ' stale'),
      html: `${avatarHtml(u)}<span class="lbl">${esc(u.nick)} · ${esc(ago(last.t))}</span>`,
      iconSize: [36, 36], iconAnchor: [18, 18]
    });
    L.marker([last.lat, last.lon], { icon, keyboard: false }).on('click', () => showPerson(u.id)).addTo(userMarkers);
  }
  $('#peopleCount').textContent = model.users.size;
}

function updateLegend() {
  const s = GS();
  $('#legendMid').textContent = `${+(s.greenDays / 2).toFixed(1)} дн`;
  $('#legendEnd').textContent = s.hideDays <= s.greenDays ? `${s.greenDays} дн ✕` : `${s.greenDays} дн${s.fadeOld ? ' · 30%' : '+'}`;
}

// нажатие на полосу — кто и когда здесь проходил
map.on('click', e => {
  const w = trackLayer.widthPx();
  const thr = Math.max(w / 2, 16);
  const cp = e.containerPoint;
  const hidden = new Set(settings.hidden);
  const minT = Date.now() - GS().hideDays * DAY;
  const bounds = map.getBounds().pad(0.1);
  const hits = new Map();
  for (const tr of model.tracks.values()) {
    if (hidden.has(tr.u)) continue;
    let prev = null, prevXY = null;
    for (const p of tr.pts) {
      if (p.t < minT) { prev = null; continue; }
      if (!bounds.contains([p.lat, p.lon]) && !(prev && bounds.contains([prev.lat, prev.lon]))) { prev = p; prevXY = null; continue; }
      const xy = map.latLngToContainerPoint([p.lat, p.lon]);
      let d = xy.distanceTo(cp), t = p.t;
      if (prev && prevXY && !isBreak(prev, p)) {
        const ds = segDist(cp, prevXY, xy);
        if (ds.d < d) { d = ds.d; t = prev.t + (p.t - prev.t) * ds.k; }
      }
      if (d <= thr) {
        const h = hits.get(tr.u);
        if (!h || t > h.t) hits.set(tr.u, { t, d });
      }
      prev = p; prevXY = xy;
    }
  }
  if (!hits.size) return;
  const rows = [...hits.entries()].sort((a, b) => b[1].t - a[1].t).map(([uid, h]) => {
    const u = model.users.get(uid) || { id: uid, nick: 'Участник' };
    return `<div style="display:flex;gap:8px;align-items:center;margin:4px 0">${avatarHtml(u)}<div><b>${esc(u.nick)}</b><br>${fmtTime(h.t)} · ${esc(ago(h.t))}</div></div>`;
  }).join('');
  L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(`<div>Здесь проходили:</div>${rows}`).openOn(map);
});
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let k = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  k = Math.max(0, Math.min(1, k));
  const x = a.x + k * dx, y = a.y + k * dy;
  return { d: Math.hypot(p.x - x, p.y - y), k };
}

// ---------- синхронизация ----------
let syncStatus = { state: 'local' };
const sync = new Sync({
  getSettings: () => settings,
  getProfile: () => profile,
  getGroupId: () => G().id,
  getPullDays: () => GS().hideDays,
  onPoints: pts => { addPoints(pts); rebuildGroupUsers(); refresh(); },
  onUsers: (list, gid) => {
    rememberUsers(list);
    saveJSON('gt.members:' + gid, list.map(u => u.id));
    if (gid === G().id) { rebuildGroupUsers(); scheduleMarkers(); }
  },
  onMarks: list => { addMarks(list); rebuildGroupUsers(); renderMarks(); updateMyScore(); },
  onGroup: g => {
    if (PROFILES[g.id]) return; // встроенные группы — настройки зашиты в приложение
    const meta = { id: g.id, name: g.name, description: g.description || '', avatar: g.avatar, kind: g.kind,
      owner_id: g.owner_id, settings: g.settings || {}, updated: g.updated_at };
    const old = groupCache[g.id];
    groupCache[g.id] = meta; saveJSON(LS.groups, groupCache);
    if (!old || JSON.stringify(old.settings) !== JSON.stringify(meta.settings) || old.name !== meta.name || old.avatar !== meta.avatar) refresh();
  },
  onStatus: s => { syncStatus = s; renderSync(); }
});

async function renderSync() {
  const el = $('#syncState');
  const unsent = await db.countUnsent().catch(() => 0);
  const s = syncStatus.state;
  el.dataset.state = s;
  const txt = { local: 'без сервера', offline: 'офлайн', syncing: 'обмен…', ok: 'на связи', error: 'ошибка' }[s] || s;
  el.querySelector('.txt').textContent = txt + (unsent && s !== 'local' ? ` · ${unsent} ждут` : '');
}
$('#syncState').addEventListener('click', () => {
  if (!sync.configured) return toast('Сервер не настроен — треки хранятся только на этом телефоне. Настройки → Сервер.', 4000);
  if (syncStatus.state === 'error') toast('Ошибка обмена: ' + sync.lastError, 5000);
  else if (!navigator.onLine) toast('Нет интернета. Трек пишется в телефон и уйдёт при появлении связи.', 4000);
  sync.tick();
});

// ---------- геолокация и запись ----------
let rec = loadJSON(LS.rec, null); // {trackId, g, started, dist, last, skipped, fast}
let watchId = null, wakeLock = null, follow = false, lastFix = null, recTimer = null, scoreTick = 0;
const recentFixes = []; // последние точки для оценки скорости, если GPS её не сообщает

function ensureMeMarker(lat, lon, acc) {
  const ll = [lat, lon];
  if (!meMarker) {
    meAcc = L.circle(ll, { radius: acc, color: '#2f7cf6', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
  } else {
    meMarker.setLatLng(ll);
    meAcc.setLatLng(ll).setRadius(acc);
  }
}

// В приложении из App Store GPS пишется и при выключенном экране (фоновый режим)
let watchBg = false;
async function startWatch(background = !!rec) {
  if (isNative) {
    if (watchId != null && watchBg === background) return;
    const old = watchId;
    watchId = 'pending'; watchBg = background;
    if (old != null && old !== 'pending') await native.clearWatch(old);
    try { watchId = await native.watchPosition(background, onPos, onPosErr); }
    catch (e) { watchId = null; toast('GPS: ' + (e.message || e)); }
    return;
  }
  if (watchId != null) return;
  if (!('geolocation' in navigator)) return toast('Геолокация недоступна');
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
function stopWatch() {
  if (watchId != null && watchId !== 'pending') {
    if (isNative) native.clearWatch(watchId); else navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
}
function onPosErr(err) {
  $('#recGps').textContent = 'GPS: нет';
  $('#recGps').className = 'bad';
  if (err.code === 1) {
    if (rec) stopRec();
    stopWatch();
    if (isNative) { if (confirmInline('Нет доступа к геопозиции. Открыть настройки приложения, чтобы разрешить?')) native.openAppSettings(); }
    else toast('Нет доступа к геопозиции. Разрешите: Настройки iPhone → Конфиденциальность → Службы геолокации → Safari → «При использовании».', 7000);
  }
}

// Скорость, км/ч: из GPS (доплеровская, точная), иначе — по смещению за последние ≥10 с.
// Короткие интервалы не используем: дрожание GPS на них даёт ложные «скорости».
function currentSpeedKmh(coords, p) {
  if (coords.speed != null && coords.speed >= 0 && isFinite(coords.speed)) return coords.speed * 3.6;
  recentFixes.push(p);
  while (recentFixes.length && p.t - recentFixes[0].t > 60000) recentFixes.shift();
  for (let i = recentFixes.length - 1; i >= 0; i--) {
    const q = recentFixes[i];
    const dt = (p.t - q.t) / 1000;
    if (dt >= 10) {
      const d = distM(q, p);
      return d > 25 ? d / dt * 3.6 : 0;
    }
  }
  return null;
}

async function onPos(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  const t = pos.timestamp || Date.now();
  const p = { lat, lon, t };
  lastFix = { lat, lon, accuracy, t };
  ensureMeMarker(lat, lon, accuracy);
  if (follow) map.panTo([lat, lon], { animate: true });
  const s = GS();
  const gpsEl = $('#recGps');
  const good = accuracy <= s.minAccuracy;
  const v = good ? currentSpeedKmh(pos.coords, p) : null;
  const fast = v != null && v > s.maxSpeed;
  gpsEl.textContent = !good ? `GPS ± ${Math.round(accuracy)} м — не пишу`
    : fast ? `🚗 ${Math.round(v)} км/ч — не пишу` : `GPS ± ${Math.round(accuracy)} м`;
  gpsEl.className = good && !fast ? 'good' : 'bad';
  if (!rec || !profile) return;
  if (!good) { rec.skipped = (rec.skipped || 0) + 1; saveJSON(LS.rec, rec); return; }
  if (fast) { rec.fast = (rec.fast || 0) + 1; saveJSON(LS.rec, rec); return; } // быстрее порога группы — не пишем
  if (rec.last) {
    const d = distM(rec.last, p);
    if (t - rec.last.t < 3000 || (d < Math.max(3, accuracy * 0.3) && t - rec.last.t < 60000)) return;
    if (!isBreak(rec.last, p)) rec.dist += d;
  }
  rec.last = p;
  saveJSON(LS.rec, rec);
  const recd = { k: `${rec.trackId}:${t}`, u: profile.id, tr: rec.trackId, g: rec.g, lat, lon, t, sent: 0 };
  addPoints([recd]);
  trackLayer.redraw();
  try { await db.putMany('points', [recd]); } catch (e) { toast('Ошибка записи: ' + e.message); }
  updateRecStats();
  if (++scoreTick % 10 === 0) updateMyScore();
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* не поддерживается */ }
}
function updateRecStats() {
  if (!rec) return;
  $('#recTime').textContent = fmtDur(Date.now() - rec.started);
  $('#recDist').textContent = fmtDist(rec.dist || 0);
}
function renderRecUi() {
  const b = $('#btnRec');
  b.classList.toggle('on', !!rec);
  b.textContent = rec ? 'Закончить запись' : 'Начать запись трека';
  $('#recStats').classList.toggle('hidden', !rec);
  clearInterval(recTimer);
  if (rec) { updateRecStats(); recTimer = setInterval(updateRecStats, 1000); }
}
function startRec(resume = false) {
  if (!profile) return;
  if (!resume) rec = { trackId: uuid(), g: G().id, started: Date.now(), dist: 0, last: null };
  saveJSON(LS.rec, rec);
  recentFixes.length = 0;
  startWatch(true);
  if (!isNative) keepAwake();
  follow = true;
  $('#btnLocate').classList.add('active');
  renderRecUi();
  if (!resume) toast((isNative ? 'Запись идёт. Телефон можно убрать в карман.' : 'Запись идёт. Держите экран включённым — в браузере iPhone не пишет трек при заблокированном экране.') +
    ` Быстрее ${GS().maxSpeed} км/ч трек не пишется.`, 5000);
}
function stopRec() {
  rec = null;
  localStorage.removeItem(LS.rec);
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
  if (isNative && watchId != null) { stopWatch(); startWatch(false); } // выключаем фоновый режим
  renderRecUi();
  sync.tick();
}
$('#btnRec').addEventListener('click', () => {
  if (!rec) startRec();
  else if (confirmInline('Закончить запись трека?')) {
    const done = { ...rec };
    stopRec();
    showHikeDone(done);
  }
});
function showHikeDone(done) {
  const tr = model.tracks.get(done.trackId);
  const n = tr ? tr.pts.length : 0;
  openSheet('Запись завершена', `
    <p><b>${fmtDist(done.dist || 0)}</b> за ${fmtDur(Date.now() - done.started)}${n ? ` · ${n} ${plural(n, 'точка', 'точки', 'точек')}` : ''}</p>
    ${done.skipped ? `<p class="muted small">Пропущено точек из‑за плохой точности GPS: ${done.skipped}.</p>` : ''}
    ${done.fast ? `<p class="muted small">Не записано точек на скорости выше ${GS().maxSpeed} км/ч: ${done.fast}.</p>` : ''}
    <p class="muted small">В GPX попадёт этот трек и все ваши метки в группе. Файл открывается в OsmAnd, Locus, Organic Maps, Яндекс Картах и Google Earth.</p>
    <button class="primary" id="hGpx" ${n ? '' : 'disabled'}>Сохранить трек в GPX</button>`, body => {
    body.querySelector('#hGpx').addEventListener('click', () => exportLastGpx(done.trackId));
  });
}

$('#btnLocate').addEventListener('click', () => {
  follow = !follow || !lastFix;
  $('#btnLocate').classList.toggle('active', follow);
  startWatch();
  if (lastFix) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 16));
  else toast('Ищу вас по GPS…');
});
map.on('dragstart', () => { follow = false; $('#btnLocate').classList.remove('active'); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (rec && !isNative) keepAwake();
    refresh();
    sync.tick();
  }
});
setInterval(() => trackLayer.redraw(), 60e3); // цвета «стареют» со временем

// ---------- выдвижные панели ----------
const sheet = $('#sheet');
function openSheet(title, html, onMount) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').scrollTop = 0;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  closeGroupMenu();
  onMount?.($('#sheetBody'));
}
function closeSheet() { sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); }
$('#sheetClose').addEventListener('click', closeSheet);
map.on('click', closeSheet);

// ---------- группы: переключатель, выбор, создание ----------
function renderGroupUi() {
  const g = G();
  $('#groupName').textContent = g.name;
  $('#groupAvatar').outerHTML = groupAvatarHtml(g, 'sm').replace('class="avatar', 'id="groupAvatar" class="avatar');
  $('#btnGroup').innerHTML = groupAvatarHtml(g, 'md');
}

function myGroupList() {
  return [...Object.values(PROFILES), ...settings.myGroups.map(id => groupCache[id]).filter(Boolean)];
}

function settingsSummary(s) {
  return `полоса ${s.widthM} м · зеленеет за ${days(s.greenDays)} · видно ${days(s.hideDays)}` +
    `${s.fadeOld ? ' · потом прозрачнее' : ''} · GPS до ${s.minAccuracy} м · до ${s.maxSpeed} км/ч`;
}

function closeGroupMenu() { $('#groupMenu').classList.add('hidden'); }
$('#btnGroup').addEventListener('click', e => {
  e.stopPropagation();
  const menu = $('#groupMenu');
  if (!menu.classList.contains('hidden')) return closeGroupMenu();
  const cur = G().id;
  menu.innerHTML = `
    <div class="gm-title">Группа на карте</div>
    ${myGroupList().map(g => `
      <button class="gm-item${g.id === cur ? ' on' : ''}" data-id="${esc(g.id)}">
        ${groupAvatarHtml(g, 'sm')}<span class="gm-name">${esc(g.name)}${isOwner(g) ? ' <small>(ваша)</small>' : ''}</span>
        <span class="gm-check">${g.id === cur ? '✓' : ''}</span>
      </button>`).join('')}
    <div class="gm-sep"></div>
    <button class="gm-item" data-act="create"><span class="avatar sm gav plus">＋</span><span class="gm-name">Создать группу</span></button>
    <button class="gm-item" data-act="join"><span class="avatar sm gav plus">🔑</span><span class="gm-name">Вступить по коду</span></button>`;
  menu.classList.remove('hidden');
  menu.querySelectorAll('.gm-item').forEach(b => b.addEventListener('click', () => {
    closeGroupMenu();
    if (b.dataset.act === 'create') return groupForm(null);
    if (b.dataset.act === 'join') return askJoinCode();
    switchGroup(b.dataset.id);
  }));
});
document.addEventListener('click', e => { if (!e.target.closest('#groupMenu') && !e.target.closest('#btnGroup')) closeGroupMenu(); });

async function switchGroup(id, { silent = false } = {}) {
  if (!groupById(id)) return toast('Группа не найдена');
  if (rec && rec.g !== id) return toast('Сначала закончите запись трека — он пишется в текущую группу.', 4000);
  settings.group = id;
  saveSettings();
  ratingCache = loadJSON(LS.rating + ':' + id, null);
  await loadGroupData();
  refresh();
  sync.tick();
  loadRating();
  if (!silent) toast(`Группа: ${G().name}`);
}

// первый выбор группы (после регистрации)
function showGroupPicker(first = false) {
  openSheet(first ? 'Выберите профиль' : 'Группы', `
    <p class="muted small">Каждый профиль — отдельная общая карта: участники видят только треки и метки своей группы. Профиль можно сменить в любой момент кнопкой справа вверху.</p>
    ${Object.values(PROFILES).map(g => `
      <button class="gcard" data-id="${g.id}">
        ${groupAvatarHtml(g, 'lg')}
        <span class="gcard-text"><b>${esc(g.name)}</b><span>${esc(g.description)}</span><small>${esc(settingsSummary(g.settings))}</small></span>
      </button>`).join('')}
    <div class="gm-sep"></div>
    <button class="btn" id="gpCreate">＋ Создать свою группу</button>
    <button class="btn" id="gpJoin">🔑 Вступить по коду</button>`, body => {
    body.querySelectorAll('.gcard').forEach(b => b.addEventListener('click', () => { closeSheet(); switchGroup(b.dataset.id); }));
    body.querySelector('#gpCreate').addEventListener('click', () => groupForm(null));
    body.querySelector('#gpJoin').addEventListener('click', askJoinCode);
  });
}

function askJoinCode() {
  const txt = prompt('Код группы или ссылка‑приглашение:');
  if (txt) joinGroup(txt);
}

// разбор кода/ссылки: …#g=КОД[&s=сервер]
function parseGroupCode(text) {
  const s = String(text).trim();
  const m = s.match(/[#&?]g=([A-Za-z0-9_-]{3,40})/);
  const srv = s.match(/[#&?]s=([A-Za-z0-9_-]+)/);
  let server = null;
  if (srv) { try { const o = JSON.parse(unb64u(srv[1])); if (o && typeof o.u === 'string' && typeof o.k === 'string') server = o; } catch {} }
  const code = m ? m[1] : (/^[A-Za-z0-9_-]{3,40}$/.test(s) ? s : null);
  return { code: code && code.toLowerCase(), server };
}

async function joinGroup(text) {
  const { code, server } = parseGroupCode(text);
  if (server && server.u !== settings.supabaseUrl) {
    settings.supabaseUrl = server.u; settings.supabaseKey = server.k; saveSettings();
    sync.resetCursor(); sync.forceProfile();
  }
  if (!code) return toast('Не похоже на код группы');
  if (PROFILES[code]) return switchGroup(code);
  if (!sync.configured) return toast('Для групп нужен сервер (Настройки → Сервер)', 4000);
  if (!navigator.onLine) return toast('Чтобы вступить в группу, нужен интернет');
  try {
    const g = await sync.getGroup(code);
    if (!g) return toast('Группа с таким кодом не найдена', 4000);
    groupCache[g.id] = { id: g.id, name: g.name, description: g.description || '', avatar: g.avatar, kind: g.kind,
      owner_id: g.owner_id, settings: g.settings || {}, updated: g.updated_at };
    saveJSON(LS.groups, groupCache);
    if (!settings.myGroups.includes(g.id)) settings.myGroups.push(g.id);
    saveSettings();
    closeSheet();
    await switchGroup(g.id, { silent: true });
    toast(`Вы в группе «${g.name}»`);
  } catch (e) { toast('Не удалось: ' + e.message, 4000); }
}

// форма группы: создание (existing = null) или правка (только создатель)
function groupForm(existing) {
  if (!existing && !sync.configured) return toast('Чтобы создать группу, нужен сервер (Настройки → Сервер)', 4000);
  const g = existing ? { ...existing } : { kind: 'other', settings: { ...DEFAULT_CUSTOM } };
  const s = { ...DEFAULT_CUSTOM, ...g.settings };
  let avatar = safePhoto(g.avatar), kind = g.kind || 'other';
  const slider = (id, label, min, max, step, val) => `
    <div class="row"><label for="${id}">${label}</label><output id="o_${id}"></output></div>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">`;
  openSheet(existing ? 'Настройки группы' : 'Новая группа', `
    <div class="row" style="justify-content:flex-start;gap:14px">
      <label class="photo-pick"><input type="file" id="gAvatar" accept="image/*" hidden><span id="gAvatarPrev" class="avatar lg gpick">${avatar ? '' : '＋ фото'}</span></label>
      <div style="flex:1"><label class="field" style="margin:0">Название<input id="gName" maxlength="40" value="${esc(g.name || '')}" placeholder="Например, Отряд «Север»"></label></div>
    </div>
    <label class="field">Описание<textarea id="gDesc" rows="2" maxlength="500" placeholder="Для кого группа, правила">${esc(g.description || '')}</textarea></label>
    <div class="muted small">Тип группы — набор меток${existing ? '' : ' и начальные настройки'}:</div>
    <div class="kinds">${TEMPLATE_KINDS.map(([k, e, n]) => `<button class="kind${k === kind ? ' on' : ''}" data-k="${k}"><span>${e}</span>${n}</button>`).join('')}</div>
    <div class="group"><h3>Настройки для всех участников</h3>
      ${slider('gW', 'Ширина полосы', 2, 100, 1, s.widthM)}
      ${slider('gG', 'Красный → зелёный за', 1, 90, 1, s.greenDays)}
      ${slider('gH', 'Показывать треки за', 1, 365, 1, s.hideDays)}
      ${slider('gA', 'Не записывать точки с погрешностью GPS больше', 5, 100, 5, s.minAccuracy)}
      ${slider('gS', 'Не записывать трек при скорости выше', 3, 150, 1, s.maxSpeed)}
      <div class="row"><label for="gF">Позеленевшие треки — прозрачность 70 %</label><label class="switch"><input type="checkbox" id="gF" ${s.fadeOld ? 'checked' : ''}><span></span></label></div>
      <p class="muted small">Эти настройки действуют у всех участников группы. Менять их может только создатель.</p>
    </div>
    <button class="primary" id="gSave">${existing ? 'Сохранить' : 'Создать группу'}</button>`, body => {
    const prev = body.querySelector('#gAvatarPrev');
    const showAv = () => { prev.style.backgroundImage = avatar ? `url('${avatar}')` : ''; prev.textContent = avatar ? '' : '＋ фото'; };
    showAv();
    body.querySelector('#gAvatar').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { avatar = await resizeImage(f, 160, 0.8, true); showAv(); } catch (err) { toast(err.message); }
    });
    const fmt = { gW: v => `${v} м`, gG: v => days(v), gH: v => days(v), gA: v => `${v} м`, gS: v => `${v} км/ч` };
    const bind = id => { const el = body.querySelector('#' + id), o = body.querySelector('#o_' + id); const f = () => { o.textContent = fmt[id](+el.value); }; f(); el.addEventListener('input', f); };
    Object.keys(fmt).forEach(bind);
    const setVals = st => {
      for (const [id, key] of [['gW', 'widthM'], ['gG', 'greenDays'], ['gH', 'hideDays'], ['gA', 'minAccuracy'], ['gS', 'maxSpeed']]) {
        const el = body.querySelector('#' + id); el.value = st[key]; el.dispatchEvent(new Event('input'));
      }
      body.querySelector('#gF').checked = !!st.fadeOld;
    };
    body.querySelectorAll('.kind').forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.k;
      body.querySelectorAll('.kind').forEach(x => x.classList.toggle('on', x === b));
      if (!existing && PROFILES[kind]) setVals(PROFILES[kind].settings); // шаблон настроек
      if (!existing && kind === 'other') setVals(DEFAULT_CUSTOM);
    }));
    body.querySelector('#gSave').addEventListener('click', async e => {
      const name = body.querySelector('#gName').value.trim().slice(0, 40);
      const description = body.querySelector('#gDesc').value.trim().slice(0, 500);
      if (!name) return toast('Введите название группы');
      if (hasBad(name) || hasBad(description)) return toast('Уберите нецензурные слова');
      if (!navigator.onLine) return toast('Нужен интернет');
      const v = id => +body.querySelector('#' + id).value;
      const meta = { name, description, avatar, kind,
        settings: { widthM: v('gW'), greenDays: v('gG'), hideDays: v('gH'), minAccuracy: v('gA'), maxSpeed: v('gS'), fadeOld: body.querySelector('#gF').checked } };
      e.target.disabled = true;
      try {
        await sync.ensureProfile();
        if (existing) {
          const ok = await sync.updateGroup(existing.id, meta);
          if (!ok) throw new Error('сервер отклонил изменения');
          groupCache[existing.id] = { ...groupCache[existing.id], ...meta, updated: Date.now() };
          saveJSON(LS.groups, groupCache);
          closeSheet(); refresh(); toast('Настройки группы сохранены');
        } else {
          const id = await sync.createGroup(meta);
          groupCache[id] = { id, ...meta, owner_id: profile.id, updated: Date.now() };
          saveJSON(LS.groups, groupCache);
          settings.myGroups.push(id); saveSettings();
          await switchGroup(id, { silent: true });
          showGroupInfo(true);
        }
      } catch (err) { e.target.disabled = false; toast('Не удалось: ' + err.message, 4500); }
    });
  });
}

// карточка группы + участники
$('#btnPeople').addEventListener('click', () => showGroupInfo());
function showGroupInfo(justCreated = false) {
  const g = G();
  const hidden = new Set(settings.hidden);
  const users = [...model.users.values()].map(u => ({ u, ...userLast(u.id) }))
    .sort((a, b) => (b.last?.t || 0) - (a.last?.t || 0));
  const list = users.map(({ u, last }) => `
    <div class="person" data-id="${esc(u.id)}">
      ${avatarHtml(u, 'md')}
      <div class="info">
        <div class="nick">${esc(u.nick)}${profile && u.id === profile.id ? ' (вы)' : ''}${g.owner_id === u.id ? ' · создатель' : ''}</div>
        <div class="meta">${last ? 'последний трек ' + esc(ago(last.t)) : 'треков пока нет'}</div>
      </div>
      ${profile && u.id !== profile.id ? '<button class="flag" aria-label="Пожаловаться">⚑</button>' : ''}
      <label class="switch" title="Показывать на карте"><input type="checkbox" ${hidden.has(u.id) ? '' : 'checked'}><span></span></label>
    </div>`).join('');
  openSheet(g.name, `
    <div class="ghead">${groupAvatarHtml(g, 'lg')}<div>
      ${g.description ? `<p class="gdesc">${esc(g.description)}</p>` : ''}
      <p class="muted small">${esc(settingsSummary(GS()))}</p>
      ${g.builtin ? '<p class="muted small">Встроенный профиль — настройки фиксированные.</p>' : `<p class="muted small">Код группы: <b class="code">${esc(g.id)}</b></p>`}
    </div></div>
    ${justCreated ? '<p class="note">Группа создана. Отправьте приглашение участникам — они увидят треки и метки только этой группы.</p>' : ''}
    <button class="btn" id="giInvite">Пригласить в группу</button>
    ${isOwner(g) ? '<button class="btn" id="giEdit">⚙ Настройки группы</button>' : ''}
    ${!g.builtin ? '<button class="btn danger" id="giLeave">Покинуть группу</button>' : ''}
    <h3 class="sub">Участники</h3>
    <p class="muted small">Нажмите на участника, чтобы показать его треки. Переключатель скрывает его треки и метки. ⚑ — пожаловаться на ник или фото.</p>
    <div class="group">${list || '<p class="muted">Пока никого.</p>'}</div>`, body => {
    body.querySelectorAll('.person').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('input').addEventListener('change', e => {
        const s = new Set(settings.hidden);
        e.target.checked ? s.delete(id) : s.add(id);
        settings.hidden = [...s];
        saveSettings(); refresh();
      });
      row.querySelector('.flag')?.addEventListener('click', e => { e.stopPropagation(); reportContent({ userId: id }); });
      row.addEventListener('click', e => { if (!e.target.closest('.switch') && !e.target.closest('.flag')) { closeSheet(); fitUser(id); } });
    });
    body.querySelector('#giInvite').addEventListener('click', shareInvite);
    body.querySelector('#giEdit')?.addEventListener('click', () => groupForm(groupCache[g.id]));
    body.querySelector('#giLeave')?.addEventListener('click', async () => {
      if (!confirmInline(`Покинуть группу «${g.name}»? Вернуться можно по коду ${g.id}.`)) return;
      settings.myGroups = settings.myGroups.filter(x => x !== g.id);
      saveSettings();
      sync.leaveGroup(g.id).catch(() => {});
      localStorage.removeItem(`gt.joined:${settings.supabaseUrl.replace(/\/+$/, '')}:${g.id}`);
      closeSheet();
      switchGroup('mushroom', { silent: true });
      toast('Вы вышли из группы');
    });
  });
}
function showPerson(id) { fitUser(id); const u = model.users.get(id); const { last } = userLast(id); if (u && last) toast(`${u.nick}: ${fmtTime(last.t)} (${ago(last.t)})`); }
function fitUser(id) {
  const minT = Date.now() - GS().hideDays * DAY;
  const pts = [];
  for (const tr of model.tracks.values()) if (tr.u === id) for (const p of tr.pts) if (p.t >= minT) pts.push([p.lat, p.lon]);
  if (!pts.length) return toast('Нет треков за период группы');
  follow = false; $('#btnLocate').classList.remove('active');
  map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 17 });
}

// ---------- настройки ----------
$('#btnSettings').addEventListener('click', showSettings);
function showSettings() {
  const s = settings, g = G(), gs = GS();
  openSheet('Настройки', `
    <div class="group"><h3>Профиль</h3>
      <div class="row">${avatarHtml(profile, 'md')}<div style="flex:1"><b>${esc(profile?.nick)}</b><div class="muted small">ID: ${esc(profile?.id.slice(0, 8))}</div></div>
      <button class="btn" id="sProfile">Изменить</button></div>
    </div>

    <div class="group"><h3>Группа: ${esc(g.name)}</h3>
      <table class="params">
        <tr><td>Ширина полосы</td><td>${gs.widthM} м</td></tr>
        <tr><td>Красный → зелёный</td><td>${days(gs.greenDays)}</td></tr>
        <tr><td>Треки видны</td><td>${days(gs.hideDays)}</td></tr>
        <tr><td>Позеленевшие треки</td><td>${gs.fadeOld ? 'прозрачность 70 %' : 'прозрачность 50 %'}</td></tr>
        <tr><td>Погрешность GPS не больше</td><td>${gs.minAccuracy} м</td></tr>
        <tr><td>Не записывать быстрее</td><td>${gs.maxSpeed} км/ч</td></tr>
      </table>
      <p class="muted small">${g.builtin ? 'Настройки встроенного профиля фиксированные.' : isOwner(g) ? 'Вы создатель группы — настройки меняются для всех участников.' : 'Настройки задаёт создатель группы.'}</p>
      ${isOwner(g) ? '<button class="btn" id="sGroupEdit">⚙ Изменить настройки группы</button>' : ''}
      <button class="btn" id="sGroups">Сменить группу</button>
    </div>

    <div class="group"><h3>Метки</h3>
      <div class="row"><label for="sPub">🌍 Показывать общие метки</label><label class="switch"><input type="checkbox" id="sPub" ${s.showPubMarks ? 'checked' : ''}><span></span></label></div>
      <div class="row"><label for="sPriv">🔒 Показывать мои личные метки</label><label class="switch"><input type="checkbox" id="sPriv" ${s.showPrivMarks ? 'checked' : ''}><span></span></label></div>
      <p class="muted small">Общие метки видны столько же, сколько треки группы. Личные хранятся только в этом телефоне и показываются всегда.</p>
    </div>

    <div class="group"><h3>Сервер обмена треками</h3>
      <p class="muted small">Бесплатный проект Supabase (инструкция в README). Без сервера треки видны только на этом телефоне, группы недоступны. Если адрес вписан в config.js, здесь ничего менять не нужно.</p>
      <label class="field">Адрес (URL)<input id="sUrl" value="${esc(s.supabaseUrl)}" autocapitalize="off" autocorrect="off" placeholder="https://xxxx.supabase.co"></label>
      <label class="field">Публичный ключ (anon / publishable)<input id="sKey" value="${esc(s.supabaseKey)}" autocapitalize="off" autocorrect="off"></label>
      <button class="btn" id="sSave">Сохранить и проверить</button>
    </div>

    <div class="group"><h3>Карта без интернета</h3>
      <p class="muted small">Просмотренные участки карты сохраняются автоматически. Перед выходом откройте нужный район и скачайте его целиком.</p>
      <button class="btn" id="sOffline">Скачать видимый район</button>
      <button class="btn danger" id="sClearTiles">Очистить кэш карт</button>
      <p class="muted small" id="sStorage"></p>
    </div>

    <div class="group"><h3>Файлы (без интернета)</h3>
      <p class="muted small">Файл с треками и метками группы можно передать через AirDrop или мессенджер; получатель нажмёт «Загрузить файл».</p>
      <button class="btn" id="sExport">Отправить мои треки и метки</button>
      <button class="btn" id="sExportAll">Отправить всё видимое</button>
      <button class="btn" id="sImport">Загрузить файл</button>
      <button class="btn" id="sLastGpx">Последний трек + мои метки в GPX</button>
      <button class="btn" id="sGpx">Все мои треки в GPX</button>
      <input type="file" id="sImportFile" accept=".json,application/json" hidden>
    </div>

    <div class="group"><h3>Аккаунт и данные</h3>
      <p class="settings-links small"><a href="#" data-doc="terms.html">Правила сообщества</a> · <a href="#" data-doc="privacy.html">Конфиденциальность</a>${DEFAULT_CONFIG.supportEmail ? ` · <a href="mailto:${esc(DEFAULT_CONFIG.supportEmail)}">Написать разработчику</a>` : ''}</p>
      <button class="btn danger" id="sDelAcc">Удалить аккаунт</button>
      <button class="btn danger" id="sWipe">Удалить все данные с телефона</button>
      <p class="muted small">${APP_NAME} · версия ${APP_VERSION}</p>
    </div>`, body => {
    for (const [id, key] of [['sPub', 'showPubMarks'], ['sPriv', 'showPrivMarks']]) {
      body.querySelector('#' + id).addEventListener('change', e => { settings[key] = e.target.checked; saveSettings(); renderMarks(); });
    }
    body.querySelector('#sProfile').addEventListener('click', () => { closeSheet(); showOnboarding(true); });
    body.querySelector('#sGroupEdit')?.addEventListener('click', () => groupForm(groupCache[g.id]));
    body.querySelector('#sGroups').addEventListener('click', () => showGroupPicker(false));
    body.querySelector('#sSave').addEventListener('click', async () => {
      const url = body.querySelector('#sUrl').value.trim(), key = body.querySelector('#sKey').value.trim();
      if (url !== settings.supabaseUrl) sync.resetCursor();
      settings.supabaseUrl = url; settings.supabaseKey = key;
      saveSettings();
      sync.forceProfile();
      await sync.tick();
      toast(syncStatus.state === 'ok' ? 'Сервер работает ✓' : syncStatus.state === 'local' ? 'Сохранено (сервер не задан)' : 'Не удалось: ' + (sync.lastError || 'нет сети'), 4500);
    });
    body.querySelector('#sOffline').addEventListener('click', () => { closeSheet(); showOffline(); });
    body.querySelector('#sClearTiles').addEventListener('click', async () => {
      if (!confirmInline('Удалить сохранённые карты?')) return;
      await db.clear('tiles'); toast('Кэш карт очищен'); showStorage(body);
    });
    body.querySelector('#sExport').addEventListener('click', () => exportTracks(false));
    body.querySelector('#sExportAll').addEventListener('click', () => exportTracks(true));
    body.querySelector('#sGpx').addEventListener('click', exportGpx);
    body.querySelector('#sLastGpx').addEventListener('click', () => exportLastGpx());
    const fileIn = body.querySelector('#sImportFile');
    body.querySelector('#sImport').addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => fileIn.files[0] && importTracks(fileIn.files[0]));
    body.querySelector('#sDelAcc').addEventListener('click', deleteAccount);
    body.querySelector('#sWipe').addEventListener('click', async () => {
      if (!confirmInline('Удалить профиль, треки, личные метки и карты с этого телефона? Общие треки и метки на сервере останутся.')) return;
      await db.clear('points'); await db.clear('users'); await db.clear('marks'); await db.clear('tiles');
      localStorage.clear(); location.reload();
    });
    bindDocLinks(body);
    showStorage(body);
  });
}
async function showStorage(body) {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) body.querySelector('#sStorage').textContent =
      `Занято: ${(est.usage / 1048576).toFixed(1)} МБ из ~${(est.quota / 1048576).toFixed(0)} МБ${persisted ? ' · защищено от очистки' : ''}`;
  } catch {}
}

// ---------- приглашения ----------
function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }

function inviteLink() {
  // в приложении из App Store адрес страницы служебный (capacitor://), поэтому берём веб-адрес из config.js
  const base = DEFAULT_CONFIG.webUrl || (isNative ? '' : location.origin + location.pathname);
  if (!base) return '';
  let h = '#g=' + encodeURIComponent(G().id);
  if (settings.supabaseUrl && settings.supabaseUrl !== DEFAULT_CONFIG.supabaseUrl) h += '&s=' + b64u(JSON.stringify({ u: settings.supabaseUrl, k: settings.supabaseKey }));
  return base + h;
}
async function shareInvite() {
  const g = G(), url = inviteLink(), store = DEFAULT_CONFIG.appStoreUrl;
  const text = `${APP_NAME}: присоединяйтесь к группе «${g.name}» — общая карта треков.` +
    (store ? `\niPhone, App Store: ${store}` : '') +
    (url ? `\nСсылка на группу: ${url}` : '') +
    (!g.builtin ? `\nКод группы: ${g.id} (в приложении: кнопка группы справа вверху → «Вступить по коду»)` : '');
  try {
    if (navigator.share) await navigator.share({ title: APP_NAME, text });
    else { await navigator.clipboard.writeText(text); toast('Приглашение скопировано'); }
  } catch (e) { if (e.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast('Приглашение скопировано'); } catch { prompt('Скопируйте:', text); } } }
}

// ---------- офлайн-карта ----------
function tileUrl(layer, z, x, y) {
  const s = layer.sub ? layer.sub[Math.abs(x + y) % layer.sub.length] : '';
  return layer.url.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y);
}
function tilesFor(bounds, zFrom, zTo) {
  const list = [];
  for (let z = zFrom; z <= zTo; z++) {
    const nw = map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const se = map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) list.push([z, x, y]);
  }
  return list;
}
function showOffline() {
  const key = currentLayerKey(), layer = LAYERS[key], bounds = map.getBounds();
  const z0 = Math.max(map.getZoom(), 10), zMax = Math.min(layer.maxNative, 17);
  const n = tilesFor(bounds, z0, zMax).length;
  openSheet('Скачать карту района', `
    <p>Будет сохранён видимый на экране участок, слой «${esc(layer.name)}», масштабы ${z0}–${zMax}.</p>
    <p><b>${n}</b> фрагментов, примерно ${Math.round(n * (key === 'sat' ? 25 : 18) / 1024)} МБ.</p>
    ${n > MAX_PREFETCH ? `<p class="muted">Слишком большой район (лимит ${MAX_PREFETCH}). Приблизьте карту.</p>` : ''}
    <p class="muted small">Скачивается слой, выбранный сейчас. Чтобы были оба, скачайте район дважды: на топокарте и на спутнике. Нужен Wi‑Fi или хороший мобильный интернет.</p>
    <div class="progress"><div id="dlBar"></div></div>
    <p class="small muted" id="dlTxt"></p>
    <button class="primary" id="dlGo" ${(n > MAX_PREFETCH || !n) ? 'disabled' : ''}>Скачать</button>`, body => {
    body.querySelector('#dlGo').addEventListener('click', async e => {
      e.target.disabled = true;
      await prefetch(layer, tilesFor(bounds, z0, zMax), body);
      e.target.textContent = 'Готово';
    });
  });
}
async function prefetch(layer, tiles, body) {
  let done = 0, failed = 0, i = 0;
  const bar = body.querySelector('#dlBar'), txt = body.querySelector('#dlTxt');
  const worker = async () => {
    while (i < tiles.length) {
      const [z, x, y] = tiles[i++];
      const url = tileUrl(layer, z, x, y);
      try {
        if (!(await db.tileHas(tileKey(url)))) {
          const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (r.ok) await db.tilePut(tileKey(url), await r.blob()); else failed++;
        }
      } catch { failed++; }
      done++;
      if (done % 5 === 0 || done === tiles.length) {
        bar.style.width = (100 * done / tiles.length) + '%';
        txt.textContent = `${done} из ${tiles.length}${failed ? ` · ошибок: ${failed}` : ''}`;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  toast(failed ? `Скачано с ошибками (${failed}). Можно повторить.` : 'Карта района сохранена ✓', 4000);
}
$('#btnOffline').addEventListener('click', showOffline);

// ---------- жалобы, блокировка, удаление аккаунта, документы ----------
function reportContent({ markId = null, userId = null }) {
  const reason = prompt(markId ? 'Что не так с меткой? (оскорбление, спам, недостоверно…)' : 'Что не так с ником или фото этого участника?');
  if (reason === null) return;
  const q = loadJSON(LS.reports, []);
  q.push({ target_user: userId, mark_id: markId, group_id: G().id, reason: reason.trim().slice(0, 500) || 'без описания', t: Date.now() });
  saveJSON(LS.reports, q);
  if (markId) { settings.hiddenMarks = [...new Set([...settings.hiddenMarks, markId])]; saveSettings(); renderMarks(); }
  closeSheet();
  sync.tick();
  toast('Спасибо! Жалоба отправлена модератору' + (markId ? ', метка скрыта у вас.' : '.'), 4000);
}
function blockUser(userId) {
  if (!confirmInline('Скрыть все треки и метки этого участника? Вернуть можно в списке участников группы.')) return;
  settings.hidden = [...new Set([...settings.hidden, userId])];
  saveSettings();
  closeSheet(); refresh();
  toast('Участник скрыт');
}
async function deleteAccount() {
  if (!confirmInline('Удалить аккаунт? С сервера будут удалены ваш ник, фото, все треки и общие метки. Созданные вами группы останутся без создателя. Это нельзя отменить.')) return;
  if (sync.configured) {
    if (!navigator.onLine) return toast('Для удаления аккаунта нужен интернет');
    try {
      await sync.ensureProfile().catch(() => {});
      const ok = await sync.deleteAccount();
      if (!ok) return toast('Сервер не подтвердил удаление. Напишите разработчику.', 5000);
    } catch (e) { return toast('Не удалось удалить: ' + e.message, 5000); }
  }
  await db.clear('points'); await db.clear('users'); await db.clear('marks');
  localStorage.clear();
  alert('Аккаунт удалён.');
  location.reload();
}
function showDoc(url) {
  $('#docTitle').textContent = url.includes('privacy') ? 'Конфиденциальность' : 'Правила сообщества';
  $('#docFrame').src = url;
  $('#docView').classList.remove('hidden');
}
$('#docClose').addEventListener('click', () => { $('#docView').classList.add('hidden'); $('#docFrame').src = 'about:blank'; });
function bindDocLinks(root) {
  root.querySelectorAll('a[data-doc]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showDoc(a.dataset.doc); }));
}
bindDocLinks(document);

// ---------- рейтинг группы ----------
// 1 балл за каждый полный километр (только участки не быстрее порога скорости группы) + 1 балл за общую метку.
const scoreOf = r => Math.floor(r.km) + r.marks;
function localRating() {
  const by = new Map();
  const get = id => by.get(id) || (by.set(id, { user_id: id, km: 0, marks: 0 }), by.get(id));
  const vmax = GS().maxSpeed / 3.6;
  for (const tr of model.tracks.values()) {
    let m = 0;
    for (let i = 1; i < tr.pts.length; i++) {
      const a = tr.pts[i - 1], b = tr.pts[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0 || isBreak(a, b)) continue;
      const d = distM(a, b);
      if (d / dt <= vmax) m += d;
    }
    if (m) get(tr.u).km += m / 1000;
  }
  for (const mk of model.marks.values()) if (!mk.priv && !mk.deleted) get(mk.u).marks++;
  return [...by.values()];
}
let ratingCache = null; // { at, rows } для активной группы
async function loadRating() {
  const gid = G().id;
  if (sync.configured && navigator.onLine && profile) {
    try {
      const rows = await sync.fetchRatings() || [];
      if (gid === G().id) {
        ratingCache = { at: Date.now(), rows: rows.map(r => ({ user_id: r.user_id, km: +r.km || 0, marks: +r.marks || 0 })) };
        saveJSON(LS.rating + ':' + gid, ratingCache);
      }
    } catch { /* остаёмся на кэше */ }
  }
  updateMyScore();
}
function currentRating() {
  const local = localRating();
  if (!ratingCache) return { rows: local, source: 'local' };
  const m = new Map(ratingCache.rows.map(r => [r.user_id, { ...r }]));
  for (const l of local) {
    const r = m.get(l.user_id);
    if (!r) m.set(l.user_id, l);
    else { r.km = Math.max(r.km, l.km); r.marks = Math.max(r.marks, l.marks); }
  }
  return { rows: [...m.values()], source: 'server', at: ratingCache.at };
}
function updateMyScore() {
  if (!profile) return;
  const me = currentRating().rows.find(r => r.user_id === profile.id);
  $('#myScore').textContent = me ? scoreOf(me) : 0;
}
$('#btnRating').addEventListener('click', async () => {
  showRating();
  await loadRating();
  if (sheet.classList.contains('open') && $('#sheetTitle').textContent.startsWith('Рейтинг')) showRating();
});
function showRating() {
  const { rows, source, at } = currentRating();
  if (profile && !rows.some(r => r.user_id === profile.id)) rows.push({ user_id: profile.id, km: 0, marks: 0 });
  const list = rows.map(r => ({ ...r, score: scoreOf(r) }))
    .filter(r => r.score > 0 || (profile && r.user_id === profile.id))
    .sort((a, b) => b.score - a.score || b.km - a.km);
  const medals = ['🥇', '🥈', '🥉'];
  const html = list.map((r, i) => {
    const u = model.users.get(r.user_id) || allUsers.get(r.user_id) || { id: r.user_id, nick: 'Участник' };
    const me = profile && r.user_id === profile.id;
    return `<div class="rank${me ? ' me' : ''}">
      <span class="pos${i < 3 ? ' medal' : ''}">${i < 3 ? medals[i] : i + 1}</span>
      ${avatarHtml(u, 'md')}
      <div class="info"><div class="nick"><b>${esc(u.nick)}</b>${me ? ' (вы)' : ''}</div>
        <div class="meta muted small">${r.km.toFixed(1)} км · ${r.marks} ${plural(r.marks, 'метка', 'метки', 'меток')}</div></div>
      <div class="score">${r.score}<small>${plural(r.score, 'балл', 'балла', 'баллов')}</small></div>
    </div>`;
  }).join('');
  const note = source === 'server'
    ? `За всё время. Обновлено ${esc(ago(at))}${navigator.onLine ? '' : ' (нет связи)'}.`
    : `Сервер недоступен — посчитано по данным в телефоне за последние ${days(GS().hideDays)}.`;
  openSheet(`Рейтинг: ${G().name}`, `
    <p class="muted small">1 балл за каждый пройденный километр и 1 балл за каждую общую метку в группе. Засчитываются только участки не быстрее ${GS().maxSpeed} км/ч.</p>
    <div class="group">${html || '<p class="muted">Пока пусто — запишите трек или поставьте общую метку.</p>'}</div>
    <p class="muted small">${note}</p>`);
}

// ---------- метки ----------
let movingMark = null;
function markVisible(m) {
  if (m.deleted || settings.hiddenMarks.includes(m.id)) return false;
  if (m.priv) return settings.showPrivMarks;            // личные — без ограничения по давности
  if (!settings.showPubMarks || settings.hidden.includes(m.u)) return false;
  return m.t >= Date.now() - GS().hideDays * DAY;
}
const markViews = new Map(); // id -> { marker, sig }
function renderMarks() {
  const seen = new Set();
  for (const m of model.marks.values()) {
    if (!markVisible(m)) continue;
    seen.add(m.id);
    const mine = !!(profile && m.u === profile.id);
    const moving = movingMark === m.id;
    const sig = [m.lat, m.lon, m.kind, m.priv, !!m.photo, mine, moving].join('|');
    const old = markViews.get(m.id);
    if (old && old.sig === sig) continue; // не пересоздаём — иначе на iPhone срываются нажатия
    if (old) marksLayer.removeLayer(old.marker);
    const [emoji] = kindOf(m.kind);
    const icon = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mk${m.priv ? ' priv' : ''}${mine ? ' mine' : ''}${moving ? ' moving' : ''}"><span>${emoji}</span></div>${m.photo ? '<i class="has-ph"></i>' : ''}`,
      iconSize: [38, 38], iconAnchor: [19, 46]
    });
    const mk = L.marker([m.lat, m.lon], { icon, draggable: moving, zIndexOffset: moving ? 3000 : 500, keyboard: false });
    const id = m.id;
    mk.on('click', () => { if (movingMark === id) finishMove(id, mk); else showMark(id); });
    mk.on('dragend', () => finishMove(id, mk));
    mk.addTo(marksLayer);
    markViews.set(id, { marker: mk, sig });
  }
  for (const [id, v] of markViews) if (!seen.has(id)) { marksLayer.removeLayer(v.marker); markViews.delete(id); }
}
async function saveMark(m) {
  m.updated = Math.max(Date.now(), (model.marks.get(m.id)?.updated || 0) + 1);
  m.sent = m.priv ? 1 : 0; // личные метки на сервер не отправляются
  model.marks.set(m.id, m);
  try { await db.putMany('marks', [m]); } catch (e) { toast('Ошибка сохранения: ' + e.message); }
  renderMarks();
  updateMyScore();
  if (!m.priv) sync.tick();
}
async function freshFix(ms = 6000) {
  const fresh = () => lastFix && Date.now() - lastFix.t < 120000;
  const ok = () => fresh() && lastFix.accuracy <= GS().minAccuracy;
  if (ok()) return lastFix;
  startWatch();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise(r => setTimeout(r, 250));
    if (ok()) return lastFix;
  }
  return fresh() ? lastFix : null;
}
$('#btnMark').addEventListener('click', async () => {
  if (!profile) return;
  if (!(lastFix && Date.now() - lastFix.t < 120000 && lastFix.accuracy <= GS().minAccuracy)) toast('Уточняю место по GPS…', 6000);
  markForm(null, await freshFix());
});
function markForm(existing, fix) {
  const m = existing ? { ...existing } : null;
  let pos = null, posNote = '';
  if (!m) {
    if (fix) { pos = { lat: fix.lat, lon: fix.lon }; posNote = `Место — по GPS (± ${Math.round(fix.accuracy)} м).` +
      (fix.accuracy > GS().minAccuracy ? ' Точность низкая: после сохранения метку можно поправить кнопкой «Переместить».' : ''); }
    else { const c = map.getCenter(); pos = { lat: c.lat, lon: c.lng }; posNote = 'GPS не определился — метка встанет в центр карты. Потом её можно передвинуть.'; }
  }
  const set = KIND_SETS[G().kind] || KIND_SETS.other;
  let kind = m?.kind || set[0], photo = safePhoto(m?.photo), priv;
  const kinds = set.includes(kind) ? set : [kind, ...set];
  openSheet(m ? 'Изменить метку' : 'Новая метка', `
    <div class="kinds">${kinds.map(k => { const [e, n] = kindOf(k); return `<button class="kind${k === kind ? ' on' : ''}" data-k="${k}"><span>${e}</span>${n}</button>`; }).join('')}</div>
    <label class="field">Описание
      <textarea id="mText" rows="3" maxlength="1000" placeholder="Что здесь? Коротко и по делу">${esc(m?.text || '')}</textarea></label>
    <div class="mphoto">
      <label class="btn"><input type="file" id="mPhoto" accept="image/*" hidden>📷 ${photo ? 'Заменить фото' : 'Добавить фото'}</label>
      <button class="btn danger${photo ? '' : ' hidden'}" id="mPhotoDel">Убрать фото</button>
      <img id="mPhotoPrev" class="mark-photo${photo ? '' : ' hidden'}" src="${photo || ''}" alt="">
    </div>
    ${posNote ? `<p class="muted small">${esc(posNote)}</p>` : ''}
    ${m ? `<p class="muted small">Сейчас метка ${m.priv ? '🔒 только для вас' : '🌍 видна группе'}.</p>` : ''}
    <div class="save2">
      <button class="save-btn me${m && m.priv ? ' cur' : ''}" data-p="1">🔒 Для меня<small>видна только мне, хранится в телефоне</small></button>
      <button class="save-btn all${m && !m.priv ? ' cur' : ''}" data-p="0">🌍 Для всех<small>видят участники группы, +1 балл</small></button>
    </div>`, body => {
    body.querySelectorAll('.kind').forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.k; body.querySelectorAll('.kind').forEach(x => x.classList.toggle('on', x === b));
    }));
    const prev = body.querySelector('#mPhotoPrev'), del = body.querySelector('#mPhotoDel');
    body.querySelector('#mPhoto').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { photo = await resizeImage(f, 1024, 0.72); prev.src = photo; prev.classList.remove('hidden'); del.classList.remove('hidden'); }
      catch (err) { toast(err.message); }
    });
    del.addEventListener('click', () => { photo = null; prev.classList.add('hidden'); del.classList.add('hidden'); });
    body.querySelectorAll('.save-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      body.querySelectorAll('.save-btn').forEach(x => { x.disabled = true; });
      priv = btn.dataset.p === '1';
      const text = body.querySelector('#mText').value.trim().slice(0, 1000);
      if (m) {
        if (!m.priv && priv) {
          // общая → личная: на сервере удаляем, в телефоне оставляем личную копию
          await saveMark({ ...m, deleted: 1, photo: null });
          await saveMark({ ...m, id: uuid(), kind, text, photo, priv: 1, deleted: 0 });
        } else {
          await saveMark({ ...m, kind, text, photo, priv: priv ? 1 : 0 });
        }
      } else {
        await saveMark({ id: uuid(), u: profile.id, g: G().id, lat: pos.lat, lon: pos.lon, t: Date.now(), kind, text, photo, priv: priv ? 1 : 0, deleted: 0 });
      }
      closeSheet();
      toast(priv ? 'Метка сохранена только для вас 🔒' : (sync.configured ? `Метка видна группе «${G().name}» 🌍` : 'Метка сохранена (сервер не настроен)'));
    }));
  });
}
function showMark(id) {
  const m = model.marks.get(id);
  if (!m) return;
  const [e, n] = kindOf(m.kind);
  const u = model.users.get(m.u) || allUsers.get(m.u) || { id: m.u, nick: 'Участник' };
  const mine = profile && m.u === profile.id;
  const photo = safePhoto(m.photo);
  openSheet(`${e} ${n}`, `
    ${photo ? `<img class="mark-photo" src="${photo}" alt="">` : ''}
    ${m.text ? `<p class="mark-text">${esc(m.text)}</p>` : ''}
    <div class="row" style="justify-content:flex-start">${avatarHtml(u, 'md')}
      <div><b>${esc(u.nick)}</b><div class="muted small">${fmtTime(m.t)} · ${esc(ago(m.t))} · ${m.priv ? '🔒 личная' : '🌍 общая'}</div></div></div>
    ${mine ? `<button class="btn" id="mEdit">Изменить</button><button class="btn" id="mMove">Переместить</button><button class="btn danger" id="mDel">Удалить</button>`
      : `<button class="btn report-btn" id="mReport">⚑ Пожаловаться</button><button class="btn" id="mBlock">Скрыть этого участника</button>`}`, body => {
    if (!mine) {
      body.querySelector('#mReport').addEventListener('click', () => reportContent({ markId: m.id, userId: m.u }));
      body.querySelector('#mBlock').addEventListener('click', () => blockUser(m.u));
      return;
    }
    body.querySelector('#mEdit').addEventListener('click', () => markForm(m));
    body.querySelector('#mMove').addEventListener('click', () => {
      closeSheet(); movingMark = m.id; renderMarks();
      toast('Перетащите метку в нужное место', 3500);
    });
    body.querySelector('#mDel').addEventListener('click', async () => {
      if (!confirmInline('Удалить метку?')) return;
      await saveMark({ ...m, deleted: 1, photo: null, text: '' });
      closeSheet(); toast('Метка удалена');
    });
  });
}
async function finishMove(id, mk) {
  const ll = mk.getLatLng();
  movingMark = null;
  const m = model.marks.get(id);
  if (m) await saveMark({ ...m, lat: ll.lat, lon: ll.lng });
  toast('Метка перемещена');
}

// ---------- обмен файлами ----------
async function collect(all) {
  const gid = G().id;
  const pts = (await db.getAll('points')).filter(p => (p.g || 'mushroom') === gid);
  const sel = all ? pts.filter(p => p.t >= Date.now() - GS().hideDays * DAY) : pts.filter(p => p.u === profile.id);
  const uids = new Set(sel.map(p => p.u));
  const marks = [...model.marks.values()].filter(m => !m.deleted && (all ? markVisible(m) : m.u === profile.id));
  for (const m of marks) uids.add(m.u);
  const users = [...uids].map(id => allUsers.get(id)).filter(Boolean);
  return { sel, users, marks };
}
async function shareFile(name, type, content) {
  if (isNative) {
    try { await native.shareTextFile(name, content); } catch (e) { toast('Не удалось поделиться: ' + (e.message || e)); }
    return;
  }
  const file = new File([content], name, { type });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const fileStamp = (t = Date.now()) => { const d = new Date(t), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
async function exportTracks(all) {
  const { sel, users, marks } = await collect(all);
  if (!sel.length && !marks.length) return toast('Нет треков и меток для отправки');
  const data = { app: 'team-tracker', v: 2, exported: Date.now(), group: { id: G().id, name: G().name },
    users: users.map(u => ({ id: u.id, nick: u.nick, photo: safePhoto(u.photo), updated: u.updated || 0 })),
    points: sel.map(p => [p.u, p.tr, +p.lat.toFixed(6), +p.lon.toFixed(6), p.t]),
    marks: marks.map(m => ({ id: m.id, u: m.u, lat: +m.lat.toFixed(6), lon: +m.lon.toFixed(6), t: m.t, kind: m.kind,
      text: m.text || '', photo: safePhoto(m.photo), priv: m.priv ? 1 : 0, updated: m.updated })) };
  await shareFile(`tracks-${fileStamp()}.json`, 'application/json', JSON.stringify(data));
}
async function importTracks(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!['team-tracker', 'gribnye-tropy'].includes(data.app) || !Array.isArray(data.points)) throw new Error('это не файл Team Tracker');
    const gid = G().id;
    const users = (data.users || []).filter(u => u && typeof u.id === 'string').map(u => ({
      id: u.id, nick: String(u.nick || '?').slice(0, 24), photo: safePhoto(u.photo), updated: +u.updated || 0 }));
    const recs = [];
    for (const r of data.points) {
      if (!Array.isArray(r) || r.length < 5) continue;
      const [u, tr, lat, lon, t] = r;
      if (typeof u !== 'string' || typeof tr !== 'string' || !isFinite(lat) || !isFinite(lon) || !isFinite(t)) continue;
      // чужие точки считаем уже «отправленными», чтобы не дублировать их на сервер
      recs.push({ k: `${tr}:${t}`, u, tr, g: gid, lat: +lat, lon: +lon, t: +t, sent: 1 });
    }
    const own = new Set((await db.getAll('points')).map(p => p.k));
    const fresh = recs.filter(r => !own.has(r.k));
    await db.putMany('points', fresh);
    const others = users.filter(u => u.id !== profile.id);
    await db.putMany('users', others);
    rememberUsers(others);
    addPoints(fresh);
    const newMarks = [];
    for (const m of Array.isArray(data.marks) ? data.marks : []) {
      if (!m || typeof m.id !== 'string' || typeof m.u !== 'string' || !isFinite(m.lat) || !isFinite(m.lon) || !isFinite(m.t)) continue;
      if (model.marks.has(m.id)) continue;
      newMarks.push({ id: m.id, u: m.u, g: gid, lat: +m.lat, lon: +m.lon, t: +m.t, kind: KINDS[m.kind] ? m.kind : 'other',
        text: String(m.text || '').slice(0, 1000), photo: safePhoto(m.photo), priv: m.priv ? 1 : 0, deleted: 0, updated: +m.updated || +m.t, sent: 1 });
    }
    await db.putMany('marks', newMarks);
    addMarks(newMarks);
    rebuildGroupUsers();
    refresh();
    toast(`Загружено в «${G().name}»: точек ${fresh.length}, меток ${newMarks.length}`);
  } catch (e) { toast('Не удалось загрузить: ' + e.message, 4000); }
}
const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function lastOwnTrack() {
  let best = null;
  for (const tr of model.tracks.values()) {
    if (tr.u !== profile.id || !tr.pts.length) continue;
    if (!best || tr.pts[tr.pts.length - 1].t > best.pts[best.pts.length - 1].t) best = tr;
  }
  return best;
}
// GPX: последний трек + все мои метки в группе (личные и общие) как путевые точки
async function exportLastGpx(trackId) {
  const tr = trackId ? model.tracks.get(trackId) : lastOwnTrack();
  if (!tr || !tr.pts.length) return toast('Нет сохранённых треков в этой группе');
  const marks = [...model.marks.values()].filter(m => m.u === profile.id && !m.deleted).sort((a, b) => a.t - b.t);
  const t0 = tr.pts[0].t;
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Team Tracker GPS" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${xml(`${profile.nick} — ${G().name}, ${fmtTime(t0)}`)}</name><time>${new Date(t0).toISOString()}</time></metadata>
`;
  for (const m of marks) {
    const [e, n] = kindOf(m.kind);
    const title = m.text ? m.text.split('\n')[0].slice(0, 60) : n;
    const desc = [m.text, `${n} · ${m.priv ? 'личная' : 'общая'} метка · ${fmtTime(m.t)}`].filter(Boolean).join('\n');
    gpx += `<wpt lat="${m.lat.toFixed(6)}" lon="${m.lon.toFixed(6)}"><time>${new Date(m.t).toISOString()}</time>` +
      `<name>${xml(`${e} ${title}`)}</name><desc>${xml(desc)}</desc><type>${m.priv ? 'Личная' : 'Общая'}</type></wpt>\n`;
  }
  gpx += `<trk><name>${xml(`${profile.nick} ${fmtTime(t0)}`)}</name><trkseg>\n`;
  tr.pts.forEach((p, i) => {
    if (i && isBreak(tr.pts[i - 1], p)) gpx += `</trkseg><trkseg>\n`; // разрыв: пропал GPS или поездка
    gpx += `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>\n`;
  });
  gpx += `</trkseg></trk>\n</gpx>\n`;
  await shareFile(`track-${fileStamp(t0)}.gpx`, 'application/gpx+xml', gpx);
  toast(`GPX: ${tr.pts.length} точек трека, ${marks.length} ${plural(marks.length, 'метка', 'метки', 'меток')}`);
}
async function exportGpx() {
  const pts = (await db.getAll('points')).filter(p => p.u === profile.id);
  if (!pts.length) return toast('Нет своих треков');
  const byTr = new Map();
  for (const p of pts) { if (!byTr.has(p.tr)) byTr.set(p.tr, []); byTr.get(p.tr).push(p); }
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Team Tracker GPS" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  for (const list of byTr.values()) {
    list.sort((a, b) => a.t - b.t);
    const gname = groupById(list[0].g || 'mushroom')?.name || '';
    gpx += `<trk><name>${xml(`${profile.nick} ${fmtTime(list[0].t)} ${gname}`)}</name><trkseg>\n`;
    list.forEach((p, i) => {
      if (i && isBreak(list[i - 1], p)) gpx += `</trkseg><trkseg>\n`;
      gpx += `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>\n`;
    });
    gpx += `</trkseg></trk>\n`;
  }
  gpx += '</gpx>\n';
  await shareFile(`tracks-all-${fileStamp()}.gpx`, 'application/gpx+xml', gpx);
}

// ---------- регистрация ----------
let pendingPhoto;
function showOnboarding(edit = false) {
  const ob = $('#onboard');
  ob.classList.remove('hidden');
  pendingPhoto = profile?.photo || null;
  $('#obNick').value = profile?.nick || '';
  $('#obGo').textContent = edit ? 'Сохранить' : 'Далее';
  $('#obAgreeRow').classList.toggle('hidden', edit);
  $('#obHint').textContent = edit ? '' : 'Без телефона и почты. Ник и фото увидят участники ваших групп.';
  renderObPhoto();
  ob.dataset.edit = edit ? '1' : '';
}
function renderObPhoto() {
  const el = $('#obPhotoPreview');
  if (pendingPhoto) { el.style.backgroundImage = `url('${pendingPhoto}')`; el.textContent = ''; el.style.borderStyle = 'solid'; }
  else { el.style.backgroundImage = ''; el.textContent = '+ фото'; el.style.borderStyle = 'dashed'; }
}
// square=true — квадратная аватарка; иначе уменьшение по длинной стороне до max
function resizeImage(file, max, quality, square = false) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      if (square) {
        const s = Math.min(W, H);
        c.width = c.height = max;
        ctx.drawImage(img, (W - s) / 2, (H - s) / 2, s, s, 0, 0, max, max);
      } else {
        const k = Math.min(1, max / Math.max(W, H));
        c.width = Math.round(W * k); c.height = Math.round(H * k);
        ctx.drawImage(img, 0, 0, c.width, c.height);
      }
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не удалось открыть фото')); };
    img.src = url;
  });
}
$('#obPhoto').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { pendingPhoto = await resizeImage(f, 160, 0.8, true); renderObPhoto(); } catch (err) { toast(err.message); }
});
$('#obGo').addEventListener('click', async () => {
  const nick = $('#obNick').value.trim().slice(0, 24);
  if (!nick) { $('#obNick').focus(); return toast('Введите ник'); }
  const edit = !!$('#onboard').dataset.edit;
  if (!edit && !$('#obAgree').checked) return toast('Отметьте согласие с правилами');
  if (hasBad(nick)) return toast('Выберите другой ник');
  profile = { id: profile?.id || uuid(), secret: profile?.secret || randomSecret(), nick, photo: pendingPhoto, updated: Date.now(), agreed: profile?.agreed || Date.now() };
  saveJSON(LS.profile, profile);
  rememberUsers([]);
  $('#onboard').classList.add('hidden');
  sync.forceProfile();
  await initMain();
});

// ---------- запуск ----------
let started = false;
let pendingInvite = null;
async function initMain() {
  rebuildGroupUsers();
  refresh();
  if (!started) {
    started = true;
    if (rec) startRec(true); else renderRecUi();
    setInterval(() => sync.tick(), 15000);
    setInterval(() => loadRating(), 10 * 60e3);
    window.addEventListener('online', () => sync.tick());
    window.addEventListener('offline', () => { syncStatus = { state: sync.configured ? 'offline' : 'local' }; renderSync(); });
  }
  sync.tick();
  loadRating();
  if (pendingInvite) { const t = pendingInvite; pendingInvite = null; await joinGroup(t); }
  else if (!settings.group) showGroupPicker(true);
}

async function boot() {
  if (/[#&](g|s)=/.test(location.hash)) {   // ссылка-приглашение: группа и/или адрес сервера
    const { code, server } = parseGroupCode(location.hash);
    if (server) { settings.supabaseUrl = server.u; settings.supabaseKey = server.k; saveSettings(); }
    if (code) pendingInvite = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (settings.group && !groupById(settings.group)) settings.group = null;
  applyGroupSettings();
  ratingCache = loadJSON(LS.rating + ':' + G().id, null);
  try {
    // чужие точки храним 90 дней (у групп дольше — по их настройке), свои — год (для GPX)
    const keepDays = Math.max(90, ...myGroupList().map(g => (g.settings || {}).hideDays || 0));
    await db.prune({ olderThan: Date.now() - keepDays * DAY, ownerId: profile?.id, ownOlderThan: Date.now() - 365 * DAY });
    rememberUsers(await db.getAll('users'));
    await loadGroupData();
  } catch (e) { toast('Ошибка хранилища: ' + e.message, 5000); }
  updateLegend();
  renderGroupUi();
  renderSync();

  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!isNative && !standalone && /iPhone|iPad|iPod/.test(navigator.userAgent) && !localStorage.getItem(LS.tip)) $('#installTip').classList.remove('hidden');
  $('#installTipClose').addEventListener('click', () => { $('#installTip').classList.add('hidden'); localStorage.setItem(LS.tip, '1'); });

  navigator.storage?.persist?.().catch(() => {});
  if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (!profile) showOnboarding(false);
  else await initMain();
}
boot();
