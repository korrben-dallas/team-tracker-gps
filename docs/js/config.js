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
  supabaseUrl: '',    // ← обязательно: https://xxxx.supabase.co
  supabaseKey: '',    // ← обязательно: публичный ключ sb_publishable_… или anon public
  webUrl: '',         // ← адрес веб-версии: https://ЛОГИН.github.io/team-tracker-gps/
  appStoreUrl: '',    // ← после публикации: https://apps.apple.com/app/idXXXXXXXXXX
  supportEmail: ''    // ← обязательно для App Store: почта для жалоб и вопросов
};
