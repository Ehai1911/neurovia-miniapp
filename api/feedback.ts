import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment, COURSE_KEY } from './_lib/db';
import { supabase } from './_lib/supabase';

// POST { kind: 'text'|'video', video_url? } — отзыв.
// Если все 3 дня выполнены → создаём «Бонус за финиш»: скидка text=20% / video=30%, срок 7 дней.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);
    if (!enr) return res.status(403).json({ ok: false, error: 'no enrollment' });

    const kind = req.body?.kind === 'video' ? 'video' : 'text';
    const video_url = req.body?.video_url ? String(req.body.video_url).trim() : null;
    if (kind === 'video' && !video_url) {
      return res.status(400).json({ ok: false, error: 'Прикрепите ссылку на видеоотзыв.' });
    }

    await supabase.from('feedback_submissions').upsert({
      enrollment_id: enr.id, kind, video_url, submitted_at: new Date().toISOString(),
    }, { onConflict: 'enrollment_id' });

    // Проверяем: все ли учебные дни выполнены
    const { data: days } = await supabase.from('steps').select('id').eq('course_key', COURSE_KEY).eq('type', 'day');
    const dayIds = (days || []).map((d: any) => d.id);
    const { data: doneRows } = await supabase.from('task_submissions')
      .select('step_id').eq('enrollment_id', enr.id).eq('completed', true).in('step_id', dayIds);
    const allDaysDone = dayIds.length > 0 && (doneRows || []).length >= dayIds.length;

    let discount: any = null;
    if (allDaysDone) {
      const percent = kind === 'video' ? 30 : 20;
      const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase.from('discounts').upsert({
        enrollment_id: enr.id, product_key: 'praktikum_adaptatsiya_nvl',
        percent, source: kind, status: 'issued',
        issued_at: new Date().toISOString(), expires_at: expires,
      }, { onConflict: 'enrollment_id' }).select().single();
      discount = data ? { percent: data.percent, expires_at: data.expires_at } : { percent, expires_at: expires };
    }

    return res.status(200).json({ ok: true, kind, discount, needs_all_days: !allDaysDone });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
