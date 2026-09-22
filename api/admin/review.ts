import { getAuthedUser } from '../_lib/auth';
import { getOrCreateUser, getAdminScope, scopeAllows } from '../_lib/db';
import { supabase } from '../_lib/supabase';

// POST { enrollment_id, step_id, comment? } — куратор отмечает задание «Принято».
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const me = await getOrCreateUser(tg);
    const scope = await getAdminScope(req, me.id);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });

    const enrollment_id = req.body?.enrollment_id;
    const step_id = req.body?.step_id;
    const comment = req.body?.comment ? String(req.body.comment) : null;
    if (!enrollment_id || !step_id) return res.status(400).json({ ok: false, error: 'enrollment_id & step_id required' });

    const { data: target } = await supabase.from('enrollments').select('cohort_id').eq('id', enrollment_id).maybeSingle();
    if (!target || !scopeAllows(scope, target.cohort_id)) return res.status(403).json({ ok: false, error: 'no access' });

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
