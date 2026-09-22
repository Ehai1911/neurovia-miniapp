import { getAuthedUser } from '../_lib/auth';
import { getOrCreateUser, ensureEnrollment } from '../_lib/db';
import { supabase } from '../_lib/supabase';

function adminGate(req: any, enr: any) {
  const dev = process.env.ALLOW_DEV_AUTH === '1' && (req.query?.admin === '1' || req.body?.admin === '1');
  return dev || ['curator', 'admin'].includes(enr?.role);
}

// POST { enrollment_id, step_id, comment? } — куратор отмечает задание «Принято».
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const me = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(me.id);
    if (!enr || !adminGate(req, enr)) return res.status(403).json({ ok: false, error: 'not a curator' });

    const enrollment_id = req.body?.enrollment_id;
    const step_id = req.body?.step_id;
    const comment = req.body?.comment ? String(req.body.comment) : null;
    if (!enrollment_id || !step_id) return res.status(400).json({ ok: false, error: 'enrollment_id & step_id required' });

    // цель в том же потоке
    const { data: target } = await supabase.from('enrollments').select('cohort_id').eq('id', enrollment_id).maybeSingle();
    if (!target || target.cohort_id !== enr.cohort_id) return res.status(403).json({ ok: false, error: 'not in your cohort' });

    await supabase.from('task_submissions').upsert({
      enrollment_id, step_id, reviewed: true, reviewer_id: me.id,
      review_comment: comment, reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'enrollment_id,step_id' });

    return res.status(200).json({ ok: true, reviewed: true });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
