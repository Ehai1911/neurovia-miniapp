import { getAuthedUser } from '../_lib/auth';
import { getOrCreateUser, getAdminScope, scopeAllows, COURSE_KEY, displayName } from '../_lib/db';
import { supabase } from '../_lib/supabase';

// GET ?enrollment_id= — карточка участника: ответы по дням, посещение, отзыв, бонус, статус проверки.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const me = await getOrCreateUser(tg);
    const scope = await getAdminScope(req, me.id);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });

    const targetId = String(req.query?.enrollment_id || '');
    if (!targetId) return res.status(400).json({ ok: false, error: 'enrollment_id required' });

    const { data: target } = await supabase
      .from('enrollments')
      .select('id, cohort_id, role, user:users(first_name,last_name,username,telegram_user_id)')
      .eq('id', targetId).maybeSingle();
    if (!target || !scopeAllows(scope, target.cohort_id)) return res.status(403).json({ ok: false, error: 'no access' });

    const { data: steps } = await supabase
      .from('steps').select('id, type, position, title, step_questions(id, position, text)')
      .eq('course_key', COURSE_KEY).order('position');

    const [att, tasks, answers, fb, disc] = await Promise.all([
      supabase.from('attendance').select('step_id, attended').eq('enrollment_id', targetId),
      supabase.from('task_submissions').select('step_id, completed, reviewed, review_comment').eq('enrollment_id', targetId),
      supabase.from('task_answers').select('question_id, answer_text').eq('enrollment_id', targetId),
      supabase.from('feedback_submissions').select('*').eq('enrollment_id', targetId).maybeSingle(),
      supabase.from('discounts').select('*').eq('enrollment_id', targetId).maybeSingle(),
    ]);

    const attSet = new Set((att.data || []).filter((a: any) => a.attended).map((a: any) => a.step_id));
    const taskMap = new Map((tasks.data || []).map((t: any) => [t.step_id, t]));
    const ansMap = new Map((answers.data || []).map((a: any) => [a.question_id, a.answer_text]));

    const daySteps = (steps || []).filter((s: any) => s.type === 'day').map((s: any) => {
      const ts: any = taskMap.get(s.id) || {};
      return {
        step_id: s.id, title: s.title, position: s.position,
        attended: attSet.has(s.id),
        done: ts.completed === true,
        reviewed: ts.reviewed === true,
        review_comment: ts.review_comment || '',
        answers: (s.step_questions || []).sort((a: any, b: any) => a.position - b.position)
          .map((q: any) => ({ q: q.text, a: ansMap.get(q.id) || '' })),
      };
    });

    return res.status(200).json({
      ok: true,
      participant: {
        enrollment_id: target.id,
        name: displayName(target.user || {}),
        tg_id: target.user?.telegram_user_id,
      },
      days: daySteps,
      feedback: fb.data ? { kind: fb.data.kind, video_url: fb.data.video_url } : null,
      discount: disc.data ? { percent: disc.data.percent, expires_at: disc.data.expires_at, status: disc.data.status } : null,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
