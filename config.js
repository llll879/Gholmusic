// Настройки GhOuL music. Ключ "publishable" публичный по задумке Supabase,
// но доступ к данным всё равно ограничивается правилами RLS на стороне сервера.
window.GHOUL_CONFIG = {
  SUPABASE_URL: "https://fippzprikvkziddsvwfq.supabase.co",
  SUPABASE_KEY: "sb_publishable_N795q9US5d2CAO6IXk3QRA_tQ0E9xQp",
  // Таблица для синхронизации избранного и плейлистов (SQL в README.md).
  SYNC_TABLE: "ghoul_library",
  // Секунд ожидания после 429, если сервер не прислал Retry-After.
  DEFAULT_COOLDOWN: 60,
  // Если письма-подтверждения упёрлись в лимит почты Supabase — ждать дольше.
  EMAIL_COOLDOWN: 600,
};
