import { getAuthedUser } from '../_lib/auth';
import { getOrCreateUser, getAdminScope } from '../_lib/db';
import { supabase } from '../_lib/supabase';

// GET — список потоков, которые видит куратор/админ (+ число участников).
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const me = await getOrCreateUser(tg);
    const scope = await getAdminScope(req, me.id);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });

    let q = supabase.from('cohorts').select('*').order('created_at', { ascending: false });
    if (!scope.global) q = q.in('id', scope.cohortIds || []);
    const { data: cohorts } = await q;

    const ids = (cohorts || []).map((c: any) => c.id);
    const countBy: Record<string, number> = {};
    if (ids.length) {
      const { data: enr } = await supabase.from('enrollments')
        .select('cohort_id, role').in('cohort_id', ids).eq('role', 'student');
      (enr || []).forEach((e: any) => { countBy[e.cohort_id] = (countBy[e.cohort_id] || 0) + 1; });
    }

    const list = (cohorts || []).map((c: any) => ({
      id: c.id, title: c.title, starts_on: c.starts_on, ends_on: c.ends_on,
      is_active: c.is_active, students: countBy[c.id] || 0,
    }));

    return res.status(200).json({ ok: true, cohorts: list });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
