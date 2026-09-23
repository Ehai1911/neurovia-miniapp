import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, getActiveEnrollment, displayName } from './_lib/db';
import { supabase } from './_lib/supabase';
import { tgCall } from './_lib/bot';

// POST { text } — обращение в поддержку. Летит в Telegram-канал (support_channel_id
// или, если не задан, review_channel_id) с данными студента, чтобы куратор сразу ответил.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await getActiveEnrollment(user.id);

    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'Напишите сообщение.' });
    if (text.length > 2000) return res.status(400).json({ ok: false, error: 'Слишком длинное сообщение.' });

    const name = displayName(user);
    const cohortTitle = enr?.cohort?.title || '—';
    const username = (tg as any).username || null;
    const uname = username ? ' (@' + username + ')' : '';

    // Сохраняем в базу — чтобы куратор видел обращения в кабинете.
    await supabase.from('support_messages').insert({
      user_id: user.id, cohort_id: enr?.cohort_id || null,
      name, username, tg_id: user.telegram_user_id, text, status: 'new',
    });

    const { data: s1 } = await supabase.from('app_settings').select('value').eq('key', 'support_channel_id').maybeSingle();
    const { data: s2 } = await supabase.from('app_settings').select('value').eq('key', 'review_channel_id').maybeSingle();
    const channelId = s1?.value || s2?.value;

    let delivered = false;
    if (channelId) {
      const msg = '🆘 Поддержка\n👤 ' + name + uname + '\n📚 ' + cohortTitle + '\n🆔 ' + user.telegram_user_id + '\n💬 ' + text;
      const j = await tgCall('sendMessage', { chat_id: channelId, text: msg });
      delivered = !!(j && j.ok);
    }

    return res.status(200).json({ ok: true, delivered });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
