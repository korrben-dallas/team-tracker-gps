/* global L */
// Слой Leaflet, рисующий треки широкой полосой в реальном масштабе (метры)
// с цветом по возрасту каждой точки: красный → жёлтый → зелёный.

const BUCKETS = 48;           // ступеней цвета
const GAP_MS = 10 * 60 * 1000; // разрыв трека, если пауза дольше 10 мин
const GAP_M = 300;            // или скачок больше 300 м

export function ageFraction(t, now, greenDays) {
  const span = Math.max(greenDays, 0.01) * 864e5;
  return Math.min(1, Math.max(0, (now - t) / span));
}

// 0 → красный (hue 0), 0.5 → жёлтый (60), 1 → зелёный (120)
export function ageColor(f) {
  const hue = Math.round(120 * f);
  const light = 50 - 8 * f; // зелёный чуть темнее, чтобы не сливался со светлой картой
  return `hsl(${hue},90%,${light}%)`;
}

export function metersPerPixel(lat, zoom) {
  return 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * Math.pow(2, zoom));
}

export function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Порог скорости активной группы (км/ч): участок, пройденный быстрее, — это поездка,
// а не ходьба, его не соединяем линией (точки на такой скорости и не записываются).
let breakSpeedKmh = Infinity;
export function setBreakSpeed(kmh) { breakSpeedKmh = kmh || Infinity; }

export const OPACITY = 0.5;       // непрозрачность полосы — всегда 50 %
export const FADED_OPACITY = 0.3; // «прозрачность 70 %» для позеленевших треков (профиль поисковиков)

export function isBreak(a, b) {
  const dt = b.t - a.t, d = distM(a, b);
  if (dt > GAP_MS || d > GAP_M) return true;
  return d > 50 && dt > 0 && d / (dt / 1000) * 3.6 > breakSpeedKmh;
}

export const TrackLayer = L.Layer.extend({
  initialize(model) {
    this.model = model;
  },

  onAdd(map) {
    this._map = map;
    const c = this._canvas = L.DomUtil.create('canvas', 'track-canvas leaflet-zoom-animated');
    map.getPane('tracksPane').appendChild(c);
    map.on('moveend zoomend resize viewreset', this._reset, this);
    if (map.options.zoomAnimation) map.on('zoomanim', this._animateZoom, this);
    this._reset();
  },

  onRemove(map) {
    map.off('moveend zoomend resize viewreset', this._reset, this);
    map.off('zoomanim', this._animateZoom, this);
    L.DomUtil.remove(this._canvas);
  },

  redraw() {
    if (!this._map || this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._reset(); });
  },

  // текущая ширина полосы в пикселях экрана
  widthPx() {
    const m = this._map;
    return Math.max(this.model.settings.widthM / metersPerPixel(m.getCenter().lat, m.getZoom()), 2);
  },

  _animateZoom(e) {
    if (!this._bounds) return;
    const scale = this._map.getZoomScale(e.zoom);
    const offset = this._map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },

  _reset() {
    const map = this._map;
    if (!map) return;
    const size = map.getSize();
    const pad = size.multiplyBy(0.35).round();
    const tlC = pad.multiplyBy(-1);
    const full = size.add(pad.multiplyBy(2));
    const origin = map.containerPointToLayerPoint(tlC);
    const c = this._canvas;
    L.DomUtil.setPosition(c, origin);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(full.x * dpr);
    c.height = Math.round(full.y * dpr);
    c.style.width = full.x + 'px';
    c.style.height = full.y + 'px';
    c.style.opacity = 1;
    this._bounds = L.latLngBounds(map.containerPointToLatLng(tlC), map.containerPointToLatLng(tlC.add(full)));
    this._draw(c.getContext('2d'), dpr, origin, full);
  },

  _draw(ctx, dpr, origin, full) {
    const map = this._map;
    const { settings } = this.model;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const w = this.widthPx();
    const now = Date.now();
    const minT = now - settings.hideDays * 864e5;
    const hidden = new Set(settings.hidden || []);
    const paths = Array.from({ length: BUCKETS + 1 }, () => null);
    const m = w + 4;
    const inView = p => p.x > -m && p.y > -m && p.x < full.x + m && p.y < full.y + m;
    const proj = pt => map.latLngToLayerPoint([pt.lat, pt.lon]).subtract(origin);

    for (const tr of this.model.tracks.values()) {
      if (hidden.has(tr.u)) continue;
      const pts = tr.pts;
      let prev = null, prevXY = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.t < minT) { prev = null; continue; }
        const xy = proj(p);
        const b = Math.round(ageFraction(p.t, now, settings.greenDays) * BUCKETS);
        const path = paths[b] || (paths[b] = new Path2D());
        if (prev && !isBreak(prev, p)) {
          if (inView(xy) || inView(prevXY)) {
            path.moveTo(prevXY.x, prevXY.y);
            path.lineTo(xy.x, xy.y);
          }
        } else if (inView(xy)) {
          // одиночная точка или начало фрагмента — круглое пятно
          path.moveTo(xy.x, xy.y);
          path.lineTo(xy.x + 0.01, xy.y);
        }
        prev = p; prevXY = xy;
      }
    }

    // Рисуем непрозрачно на вспомогательный холст и переносим с нужной прозрачностью —
    // так наложения полос не темнеют. Позеленевшие треки при fadeOld — отдельным, более прозрачным слоем.
    const off = this._offCanvas || (this._offCanvas = document.createElement('canvas'));
    off.width = ctx.canvas.width; off.height = ctx.canvas.height;
    const o = off.getContext('2d');
    const layer = (from, to, alpha) => {
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, off.width, off.height);
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.lineCap = 'round'; o.lineJoin = 'round'; o.lineWidth = w;
      let any = false;
      for (let b = from; b >= to; b--) {           // старое снизу, свежее (красное) сверху
        if (!paths[b]) continue;
        o.strokeStyle = ageColor(b / BUCKETS);
        o.stroke(paths[b]);
        any = true;
      }
      if (!any) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
    };
    if (settings.fadeOld) {
      layer(BUCKETS, BUCKETS, FADED_OPACITY);
      layer(BUCKETS - 1, 0, OPACITY);
    } else {
      layer(BUCKETS, 0, OPACITY);
    }
  }
});
