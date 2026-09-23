import { supabase } from './_lib/supabase';
import { sendWithApp } from './_lib/bot';

// Напоминания о занятиях. Дёргается часто (внешний планировщик раз в ~10 мин),
// сам решает, что пора отправить, и защищается от повторов через miniapp.reminder_sent.
//  • за 24 часа  → «Завтра в HH:MM …»
//  • за 15 минут → «Через 15 минут … + Zoom»
// Доступ: ?key=CRON_SECRET  ИЛИ  Authorization: Bearer <CRON_SECRET>  ИЛИ  ?dev=1 (ALLOW_DEV_AUTH).

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

// "2026-10-05T19:00" (время Алматы, UTC+5) → миллисекунды UTC
function parseKZ(at: string): number {
  const s = String(at || '');
  if (!s) return NaN;
  const withSec = s.length === 16 ? s + ':00' : s; // добавить секунды
  return Date.parse(withSec + '+05:00');
}
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
      // студентов берём один раз на поток
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
        const start = parseKZ(s.at);
        if (isNaN(start)) continue;
        const title = String(s.title || 'Занятие');

        const jobs: Array<{ kind: string; cond: boolean; text: string; extra: any[] }> = [
          { kind: 'd1', cond: now >= start - 24 * HOUR && now < start,
            text: '🔔 Завтра в ' + hhmm(s.at) + ' — ' + title + '. Не забудьте!', extra: [] },
          { kind: 'm15', cond: now >= start - 15 * MIN && now < start + 15 * MIN,
            text: '🔔 Через 15 минут — ' + title + '. Подключайтесь 👇', extra: zoomRow },
        ];

        for (const job of jobs) {
          if (!job.cond) continue;
          // атомарная заявка: если такая строка уже есть — пропускаем (уже отправляли)
          const claim = await supabase.from('reminder_sent')
            .insert({ cohort_id: c.id, session_at: String(s.at), kind: job.kind }).select();
          if (claim.error) continue; // конфликт PK → уже сделано
          const ids = await getStudents();
          let ok = 0;
          for (const chatId of ids) {
            const j = await sendWithApp(chatId, job.text, base, job.extra);
            if (j && j.ok) { sent++; ok++; } else failed++;
          }
          if (ok === 0) {
            // никому не ушло — снимаем заявку, чтобы повторить на след. запуске
            await supabase.from('reminder_sent').delete()
              .eq('cohort_id', c.id).eq('session_at', String(s.at)).eq('kind', job.kind);
          }
          fired.push({ cohort: c.title, session: s.at, kind: job.kind, students: ids.length, ok });
        }
      }
    }

    return res.status(200).json({ ok: true, now: new Date(now).toISOString(), sent, failed, fired });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
