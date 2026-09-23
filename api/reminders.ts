import { supabase } from './_lib/supabase';

// Напоминания о занятиях. Запускается Vercel Cron (раз в день утром).
// Смотрит расписание активных потоков; если сегодня (по времени Казахстана, UTC+5)
// есть встреча — шлёт студентам потока сообщение в Telegram.
// Ручной тест: /api/reminders?dev=1 (при ALLOW_DEV_AUTH=1).

const TOKEN = process.env.BOT_TOKEN || '';
const KZ_OFFSET_MS = 5 * 3600 * 1000; // UTC+5

async function sendMessage(chat_id: number | string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
  });
  return r.json();
}

export default async function handler(req: any, res: any) {
  try {
    // Доступ: секрет Vercel Cron ИЛИ dev-запуск для теста
    const cronSecret = process.env.CRON_SECRET;
    const authed =
      (cronSecret && req.headers['authorization'] === 'Bearer ' + cronSecret) ||
      (process.env.ALLOW_DEV_AUTH === '1' && (req.query?.dev === '1'));
    if (!authed) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!TOKEN) return res.status(500).json({ ok: false, error: 'BOT_TOKEN not set' });

    const todayKZ = new Date(Date.now() + KZ_OFFSET_MS).toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: settingsRows } = await supabase.from('app_settings').select('key,value');
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => { settings[r.key] = r.value; });
    const zoom = settings['zoom_url'] || '';

    const { data: cohorts } = await supabase.from('cohorts').select('id, title, schedule').eq('is_active', true);

    let sent = 0, failed = 0;
    const report: any[] = [];

    for (const c of cohorts || []) {
      const sched = Array.isArray(c.schedule) ? c.schedule : [];
      const todays = sched.filter((s: any) => String(s?.at || '').slice(0, 10) === todayKZ);
      if (todays.length === 0) continue;

      const { data: enrolls } = await supabase.from('enrollments')
        .select('user:users(telegram_user_id)')
        .eq('cohort_id', c.id).eq('role', 'student').eq('status', 'active');
      const chatIds = (enrolls || [])
        .map((e: any) => e.user?.telegram_user_id)
        .filter((x: any) => !!x);

      for (const s of todays) {
        const time = String(s.at || '').slice(11, 16); // HH:MM
        const title = String(s.title || 'Занятие');
        const note = s.note ? ' (' + String(s.note) + ')' : '';
        const text = '🔔 Сегодня в ' + time + ' — ' + title + note + '.' + (zoom ? '\n🎥 Подключиться: ' + zoom : '');
        for (const chatId of chatIds) {
          const j = await sendMessage(chatId, text);
          if (j && j.ok) sent++; else failed++;
        }
      }
      report.push({ cohort: c.title, sessions: todays.length, students: chatIds.length });
    }

    return res.status(200).json({ ok: true, date: todayKZ, sent, failed, report });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
