import { supabase } from './_lib/supabase';
import { clubTgCall } from './_lib/bot';

// Клубные напоминания: если сегодня по расписанию клуба (club_schedule) есть эфир — пост в канал клуба
// клуб-ботом (@bahitadminbot). Запускается Vercel Cron раз в день (09:00 Алматы).
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
    if (!process.env.CLUB_BOT_TOKEN) return res.status(500).json({ ok: false, error: 'CLUB_BOT_TOKEN not set' });

    const now = Date.now();
    const todayKZ = new Date(now + 5 * HOUR).toISOString().slice(0, 10); // YYYY-MM-DD (Алматы)

    const { data: settingsRows } = await supabase.from('app_settings').select('key,value');
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => { settings[r.key] = r.value; });
    // Напоминания ученикам интенсива шлёт сервер Спринта (sprint.neurovialabs.kz) — здесь только клуб.
    const sent = 0, failed = 0;
    const fired: any[] = [];

    // ---- Клубные эфиры: если сегодня есть эфир → пост в канал клуба ----
    let clubPosted = 0;
    try {
      const channel = settings['main_channel_id'];
      let clubSched: any[] = [];
      try { clubSched = JSON.parse(settings['club_schedule'] || '[]'); } catch { clubSched = []; }
      let clubSections: any[] = [];
      try { clubSections = JSON.parse(settings['club_sections'] || '[]'); } catch { clubSections = []; }
      const secName = (id: string) => {
        const f = (clubSections || []).find((x: any) => x && x.id === id);
        return f ? ((f.emoji ? f.emoji + ' ' : '') + f.title) : '';
      };
      let log: string[] = [];
      try { log = JSON.parse(settings['club_reminder_log'] || '[]'); } catch { log = []; }
      if (channel && Array.isArray(clubSched)) {
        for (const s of clubSched) {
          if (String(s?.date || '').slice(0, 10) !== todayKZ) continue;
          const keyId = s.date + '|' + (s.time || '') + '|' + String(s.title || '').slice(0, 40);
          if (log.indexOf(keyId) >= 0) continue; // уже напоминали
          const sec = secName(String(s.section || ''));
          const t = '🔔 Сегодня' + (s.time ? (' в ' + s.time) : '') + ' — ' + String(s.title || 'эфир') +
            (s.expert ? (' · ' + s.expert) : '') + (sec ? ('\n' + sec) : '') + (s.zoom ? ('\n\n🎥 Подключиться: ' + s.zoom) : '');
          const j = await clubTgCall('sendMessage', { chat_id: channel, text: t, link_preview_options: { is_disabled: true } });
          if (j && j.ok) { clubPosted++; log.push(keyId); }
        }
        await supabase.from('app_settings').upsert(
          { key: 'club_reminder_log', value: JSON.stringify(log.slice(-300)), updated_at: new Date().toISOString() },
          { onConflict: 'key' });
      }
    } catch (e) { /* клубные напоминания не должны ронять крон */ }

    return res.status(200).json({ ok: true, date: todayKZ, sent, failed, fired, clubPosted });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
