// Мост к нативным возможностям iPhone (когда приложение запущено из App Store).
// В браузере/PWA isNative = false и используются обычные веб-API.
import { Capacitor, registerPlugin } from '../vendor/capacitor/core.js';

export const isNative = Capacitor.isNativePlatform();

const BG = isNative ? registerPlugin('BackgroundGeolocation') : null;
const Filesystem = isNative ? registerPlugin('Filesystem') : null;
const Share = isNative ? registerPlugin('Share') : null;

// Слежение за GPS. background=true — продолжает писать при выключенном экране
// (на iOS в строке состояния появляется синий индикатор геолокации).
export async function watchPosition(background, onPos, onErr) {
  const opts = { requestPermissions: true, stale: false, distanceFilter: 2 };
  if (background) {
    opts.backgroundTitle = 'Team Tracker GPS';
    opts.backgroundMessage = 'Идёт запись трека';
  }
  return BG.addWatcher(opts, (loc, err) => {
    if (err) {
      onErr({ code: err.code === 'NOT_AUTHORIZED' ? 1 : 2, message: err.message || String(err.code) });
      return;
    }
    if (!loc) return;
    onPos({
      coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, speed: loc.speed ?? null },
      timestamp: loc.time || Date.now()
    });
  });
}

export function clearWatch(id) {
  return BG.removeWatcher({ id }).catch(() => {});
}

export function openAppSettings() {
  return BG.openSettings().catch(() => {});
}

// Сохранить текстовый файл во временную папку и открыть системное меню «Поделиться»
export async function shareTextFile(name, content) {
  const { uri } = await Filesystem.writeFile({ path: name, data: content, directory: 'CACHE', encoding: 'utf8' });
  try {
    await Share.share({ title: name, files: [uri] });
  } catch (e) {
    if (!/cancel/i.test(String(e?.message || e))) throw e;
  }
}
