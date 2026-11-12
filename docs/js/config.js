// Настройки по умолчанию. Заполните перед публикацией (см. README.md).
//
// supabaseUrl  — адрес проекта Supabase, например https://abcdxyz.supabase.co
// supabaseKey  — публичный ключ (anon / publishable) из Project Settings → API Keys
// webUrl       — адрес веб-версии на GitHub Pages, например https://login.github.io/team-tracker-gps/
//                (там же лежат privacy.html и terms.html для App Store)
// appStoreUrl  — ссылка на приложение в App Store (появится после публикации), например
//                https://apps.apple.com/app/id1234567890
// supportEmail — почта для жалоб и вопросов (Apple требует контакт для связи)
export const DEFAULT_CONFIG = {
  supabaseUrl: 'https://zfapomqgkrmflikvwjhm.supabase.co',  // без /rest/v1/ — приложение добавляет путь само
  supabaseKey: 'sb_publishable_z1_lUOEx4IiHpBZYB2-Cyw_WtvgP9yu',  // публичный ключ: можно публиковать, данные защищают RLS-политики
  webUrl: 'https://korrben-dallas.github.io/team-tracker-gps/',  // веб-версия на GitHub Pages
  appStoreUrl: '',    // ← после публикации: https://apps.apple.com/app/idXXXXXXXXXX
  supportEmail: 'vladlen.chirukhin@gmail.com'  // почта для жалоб и вопросов
};
