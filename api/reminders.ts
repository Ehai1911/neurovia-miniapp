import { supabase } from './_lib/supabase';
import { sendWithApp } from './_lib/bot';

// Напоминания о занятиях. Запускается Vercel Cron раз в день (утром, 09:00 Алматы).
// Если сегодня (по времени UTC+5) по расписанию потока есть встреча — шлёт студентам
// «🔔 Сегодня в HH:MM — …» + кнопка Zoom + кнопка приложения. Защита от повторов: reminder_sent.
// Доступ: ?key=CRON_SECRET | Authorization: Bearer <CRON_SECRET> | ?dev=1 (ALLOW_DEV_AUTH).

const HOUR = 3600 * 1000;
function hhmm(at: string): string { return String(at || '').slice(11, 16); }

export default async function handler(req: any, res: any) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const key = req.query?.key;
    const authed =
      (cronSecret && (req.headers['authorization'] === 'Bearer ' + cronSecret || key === cronSecret)) ||
      (process.env.ALLOW_DEV_AUTH === '1' && req.query?.dev === '1');
    if (!authed) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!process.env.BOT_TOKEN) return res.status(500).json({ ok: false, error: 'BOT_TOKEN not set' });

    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    const base = 'https://' + host;
    const now = Date.now();
    const todayKZ = new Date(now + 5 * HOUR).toISOString().slice(0, 10); // YYYY-MM-DD (Алматы)

    const { data: settingsRows } = await supabase.from('app_settings').select('key,value');
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => { settings[r.key] = r.value; });
    const zoom = settings['zoom_url'] || '';
    const zoomRow = zoom ? [[{ text: '🎥 Подключиться в Zoom', url: zoom }]] : [];

    const { data: cohorts } = await supabase.from('cohorts').select('id, title, schedule').eq('is_active', true);

    let sent = 0, failed = 0;
    const fired: any[] = [];

    for (const c of cohorts || []) {
      const sched = Array.isArray(c.schedule) ? c.schedule : [];
      let chatIds: any[] | null = null;
      const getStudents = async () => {
        if (chatIds) return chatIds;
        const { data: enrolls } = await supabase.from('enrollments')
          .select('user:users(telegram_user_id)')
          .eq('cohort_id', c.id).eq('role', 'student').eq('status', 'active');
        chatIds = (enrolls || []).map((e: any) => e.user?.telegram_user_id).filter((x: any) => !!x);
        return chatIds;
      };

      for (const s of sched) {
        if (String(s?.at || '').slice(0, 10) !== todayKZ) continue; // не сегодня
        // атомарная заявка — не отправлять дважды
        const claim = await supabase.from('reminder_sent')
          .insert({ cohort_id: c.id, session_at: String(s.at), kind: 'today' }).select();
        if (claim.error) continue;

        const ids = await getStudents();
        const title = String(s.title || 'Занятие');
        const text = '🔔 Сегодня в ' + hhmm(s.at) + ' — ' + title + '. Подключайтесь 👇';
        let ok = 0;
        for (const chatId of ids) {
          const j = await sendWithApp(chatId, text, base, zoomRow);
          if (j && j.ok) { sent++; ok++; } else failed++;
        }
        if (ok === 0) {
          await supabase.from('reminder_sent').delete()
            .eq('cohort_id', c.id).eq('session_at', String(s.at)).eq('kind', 'today');
        }
        fired.push({ cohort: c.title, session: s.at, students: ids.length, ok });
      }
    }

    return res.status(200).json({ ok: true, date: todayKZ, sent, failed, fired });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
