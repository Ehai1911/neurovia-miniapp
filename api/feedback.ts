import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment, COURSE_KEY } from './_lib/db';
import { supabase } from './_lib/supabase';

// POST { kind?: 'text'|'video', video_url? } — отзыв (обратная связь).
// Скидок НЕТ. Если все 3 дня выполнены → доступен «Бонус за финиш» (чек-лист/мини-курс).
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);
    if (!enr) return res.status(403).json({ ok: false, error: 'no enrollment' });

    const kind = req.body?.kind === 'video' ? 'video' : 'text';
    const video_url = req.body?.video_url ? String(req.body.video_url).trim() : null;

    await supabase.from('feedback_submissions').upsert({
      enrollment_id: enr.id, kind, video_url, submitted_at: new Date().toISOString(),
    }, { onConflict: 'enrollment_id' });

    // Проверяем: все ли учебные дни выполнены → открыт ли бонус за финиш
    const { data: days } = await supabase.from('steps').select('id').eq('course_key', COURSE_KEY).eq('type', 'day');
    const dayIds = (days || []).map((d: any) => d.id);
    const { data: doneRows } = await supabase.from('task_submissions')
      .select('step_id').eq('enrollment_id', enr.id).eq('completed', true).in('step_id', dayIds);
    const allDaysDone = dayIds.length > 0 && (doneRows || []).length >= dayIds.length;

    return res.status(200).json({ ok: true, kind, bonus_unlocked: allDaysDone, needs_all_days: !allDaysDone });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
