import { resolveAdmin } from '../_lib/adminAccess';
import { scopeAllows, COURSE_KEY, displayName } from '../_lib/db';
import { supabase } from '../_lib/supabase';

// GET ?cohort_id= — участники выбранного потока + прогресс.
export default async function handler(req: any, res: any) {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });

    const cohortId = String(req.query?.cohort_id || '');
    if (!cohortId) return res.status(400).json({ ok: false, error: 'cohort_id required' });
    if (!scopeAllows(scope, cohortId)) return res.status(403).json({ ok: false, error: 'no access to cohort' });

    const { data: cohort } = await supabase.from('cohorts').select('id,title').eq('id', cohortId).maybeSingle();

    const { data: days } = await supabase.from('steps').select('id').eq('course_key', COURSE_KEY).eq('type', 'day');
    const dayIds = new Set((days || []).map((d: any) => d.id));
    const dayCount = dayIds.size;

    const { data: enrolls } = await supabase
      .from('enrollments')
      .select('id, role, status, enrolled_at, user:users(id, first_name, last_name, username, telegram_user_id)')
      .eq('cohort_id', cohortId)
      .order('enrolled_at', { ascending: true });

    const eids = (enrolls || []).map((e: any) => e.id);
    if (eids.length === 0) {
      return res.status(200).json({ ok: true, cohort, summary: { total: 0, completed: 0, avgProgress: 0, tasksDone: 0, tasksTotal: 0 }, participants: [] });
    }

    const [att, tasks, fb, disc] = await Promise.all([
      supabase.from('attendance').select('enrollment_id, step_id, attended').in('enrollment_id', eids),
      supabase.from('task_submissions').select('enrollment_id, step_id, completed').in('enrollment_id', eids),
      supabase.from('feedback_submissions').select('enrollment_id, kind').in('enrollment_id', eids),
      supabase.from('discounts').select('enrollment_id, percent').in('enrollment_id', eids),
    ]);

    const attBy: Record<string, number> = {};
    (att.data || []).forEach((a: any) => { if (a.attended && dayIds.has(a.step_id)) attBy[a.enrollment_id] = (attBy[a.enrollment_id] || 0) + 1; });
    const taskBy: Record<string, number> = {};
    (tasks.data || []).forEach((t: any) => { if (t.completed && dayIds.has(t.step_id)) taskBy[t.enrollment_id] = (taskBy[t.enrollment_id] || 0) + 1; });
    const fbBy: Record<string, string> = {};
    (fb.data || []).forEach((f: any) => { fbBy[f.enrollment_id] = f.kind; });
    const discBy: Record<string, any> = {};
    (disc.data || []).forEach((d: any) => { discBy[d.enrollment_id] = d; });

    const participants = (enrolls || []).map((e: any) => {
      const attended = attBy[e.id] || 0;
      const done = taskBy[e.id] || 0;
      const progress = dayCount ? Math.round(((attended + done) / (dayCount * 2)) * 100) : 0;
      return {
        enrollment_id: e.id, role: e.role, name: displayName(e.user || {}),
        tg_id: e.user?.telegram_user_id, attended, done, dayCount,
        feedback: fbBy[e.id] || null,
        discount: discBy[e.id] ? { percent: discBy[e.id].percent } : null,
        progress,
      };
    });

    const students = participants.filter((p: any) => p.role === 'student');
    const summary = {
      total: students.length,
      completed: students.filter((p: any) => p.done >= dayCount && dayCount > 0).length,
      avgProgress: students.length ? Math.round(students.reduce((s: number, p: any) => s + p.progress, 0) / students.length) : 0,
      tasksDone: students.reduce((s: number, p: any) => s + p.done, 0),
      tasksTotal: students.length * dayCount,
    };

    return res.status(200).json({ ok: true, cohort, summary, participants });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
