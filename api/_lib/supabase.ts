import { createClient } from '@supabase/supabase-js';

// Единый клиент к нашей БД. Работаем service_role-ключом (в обход RLS),
// доступ ограничиваем в коде по проверенному telegram-пользователю.
// Все наши таблицы живут в схеме `miniapp`.
export const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  {
    db: { schema: 'miniapp' },
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
