import { resolveAdmin } from './adminAccess';
import { scopeAllows, COURSE_KEY, displayName } from './db';
import { supabase } from './supabase';
import { verifyPassword, signToken, hashPassword } from './adminAuth';

// ---------- POST login ----------
export async function login(req: any, res: any) {
  try {
    const lg = String(req.body?.login || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!lg || !password) return res.status(400).json({ ok: false, error: 'Введите логин и пароль.' });
    if (!process.env.ADMIN_JWT_SECRET) return res.status(500).json({ ok: false, error: 'ADMIN_JWT_SECRET not set' });
    const { data: acc } = await supabase.from('curator_accounts').select('*').eq('login', lg).maybeSingle();
    if (!acc || !verifyPassword(password, acc.pass)) return res.status(401).json({ ok: false, error: 'Неверный логин или пароль.' });
    const token = signToken({ sub: acc.id, login: acc.login, is_admin: acc.is_admin, name: acc.name });
    return res.status(200).json({ ok: true, token, name: acc.name || acc.login });
  } catch (e: any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- GET/POST seed-curator (dev only) ----------
export async function seedCurator(req: any, res: any) {
  if (process.env.ALLOW_DEV_AUTH !== '1') return res.status(403).json({ ok: false, error: 'disabled' });
  try {
    const lg = String(req.query?.login || req.body?.login || 'curator').trim().toLowerCase();
    const password = String(req.query?.password || req.body?.password || 'test123');
    const name = String(req.query?.name || req.body?.name || 'Kurator');
    const pass = hashPassword(password);
    const { data, error } = await supabase.from('curator_accounts')
      .upsert({ login: lg, pass, name, is_admin: true }, { onConflict: 'login' }).select('login, name').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, account: data });
  } catch (e: any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- GET cohorts ----------
export async function cohorts(req: any, res: any) {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });
    let q = supabase.from('cohorts').select('*').order('created_at', { ascending: false });
    if (!scope.global) q = q.in('id', scope.cohortIds || []);
    const { data: list } = await q;
    const ids = (list || []).map((c: any) => c.id);
    const countBy: Record<string, number> = {};
    if (ids.length) {
      const { data: enr } = await supabase.from('enrollments').select('cohort_id, role').in('cohort_id', ids).eq('role', 'student');
      (enr || []).forEach((e: any) => { countBy[e.cohort_id] = (countBy[e.cohort_id] || 0) + 1; });
    }
    const cohortsOut = (list || []).map((c: any) => ({ id: c.id, title: c.title, starts_on: c.starts_on, ends_on: c.ends_on, is_active: c.is_active, schedule: c.schedule || [], students: countBy[c.id] || 0 }));
    return res.status(200).json({ ok: true, cohorts: cohortsOut });
  } catch (e: any) { return res.status(401).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- GET participants ?cohort_id= ----------
export async function participants(req: any, res: any) {
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

    const { data: enrolls } = await supabase.from('enrollments')
      .select('id, role, status, enrolled_at, user:users(id, first_name, last_name, username, telegram_user_id)')
      .eq('cohort_id', cohortId).order('enrolled_at', { ascending: true });
    const eids = (enrolls || []).map((e: any) => e.id);
    if (eids.length === 0) return res.status(200).json({ ok: true, cohort, summary: { total: 0, completed: 0, avgProgress: 0, tasksDone: 0, tasksTotal: 0 }, participants: [] });

    const [att, tasks, fb] = await Promise.all([
      supabase.from('attendance').select('enrollment_id, step_id, attended').in('enrollment_id', eids),
      supabase.from('task_submissions').select('enrollment_id, step_id, completed').in('enrollment_id', eids),
      supabase.from('feedback_submissions').select('enrollment_id, kind').in('enrollment_id', eids),
    ]);
    const attBy: Record<string, number> = {};
    (att.data || []).forEach((a: any) => { if (a.attended && dayIds.has(a.step_id)) attBy[a.enrollment_id] = (attBy[a.enrollment_id] || 0) + 1; });
    const taskBy: Record<string, number> = {};
    (tasks.data || []).forEach((t: any) => { if (t.completed && dayIds.has(t.step_id)) taskBy[t.enrollment_id] = (taskBy[t.enrollment_id] || 0) + 1; });
    const fbBy: Record<string, string> = {};
    (fb.data || []).forEach((f: any) => { fbBy[f.enrollment_id] = f.kind; });

    const parts = (enrolls || []).map((e: any) => {
      const attended = attBy[e.id] || 0; const done = taskBy[e.id] || 0;
      const progress = dayCount ? Math.round(((attended + done) / (dayCount * 2)) * 100) : 0;
      return { enrollment_id: e.id, role: e.role, name: displayName(e.user || {}), tg_id: e.user?.telegram_user_id, attended, done, dayCount, feedback: fbBy[e.id] || null, progress };
    });
    const studs = parts.filter((p: any) => p.role === 'student');
    const summary = {
      total: studs.length,
      completed: studs.filter((p: any) => p.done >= dayCount && dayCount > 0).length,
      avgProgress: studs.length ? Math.round(studs.reduce((s: number, p: any) => s + p.progress, 0) / studs.length) : 0,
      tasksDone: studs.reduce((s: number, p: any) => s + p.done, 0),
      tasksTotal: studs.length * dayCount,
    };
    return res.status(200).json({ ok: true, cohort, summary, participants: parts });
  } catch (e: any) { return res.status(401).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- GET participant ?enrollment_id= ----------
export async function participant(req: any, res: any) {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });
    const targetId = String(req.query?.enrollment_id || '');
    if (!targetId) return res.status(400).json({ ok: false, error: 'enrollment_id required' });

    const { data: target } = await supabase.from('enrollments')
      .select('id, cohort_id, role, bonus_course, user:users(first_name,last_name,username,telegram_user_id)')
      .eq('id', targetId).maybeSingle();
    if (!target || !scopeAllows(scope, target.cohort_id)) return res.status(403).json({ ok: false, error: 'no access' });

    const { data: steps } = await supabase.from('steps')
      .select('id, type, position, title, step_questions(id, position, text)')
      .eq('course_key', COURSE_KEY).order('position');
    const [att, tasks, answers, fb] = await Promise.all([
      supabase.from('attendance').select('step_id, attended').eq('enrollment_id', targetId),
      supabase.from('task_submissions').select('step_id, completed, reviewed, review_comment').eq('enrollment_id', targetId),
      supabase.from('task_answers').select('question_id, answer_text').eq('enrollment_id', targetId),
      supabase.from('feedback_submissions').select('*').eq('enrollment_id', targetId).maybeSingle(),
    ]);
    const attSet = new Set((att.data || []).filter((a: any) => a.attended).map((a: any) => a.step_id));
    const taskMap = new Map((tasks.data || []).map((t: any) => [t.step_id, t]));
    const ansMap = new Map((answers.data || []).map((a: any) => [a.question_id, a.answer_text]));
    const days = (steps || []).filter((s: any) => s.type === 'day').map((s: any) => {
      const ts: any = taskMap.get(s.id) || {};
      return {
        step_id: s.id, title: s.title, position: s.position,
        attended: attSet.has(s.id), done: ts.completed === true, reviewed: ts.reviewed === true, review_comment: ts.review_comment || '',
        answers: (s.step_questions || []).sort((a: any, b: any) => a.position - b.position).map((q: any) => ({ q: q.text, a: ansMap.get(q.id) || '' })),
      };
    });
    return res.status(200).json({
      ok: true,
      participant: { enrollment_id: target.id, name: displayName(target.user || {}), tg_id: target.user?.telegram_user_id, cohort_id: target.cohort_id, bonus_course: !!target.bonus_course },
      days,
      feedback: fb.data ? { kind: fb.data.kind, video_url: fb.data.video_url } : null,
    });
  } catch (e: any) { return res.status(401).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- POST review ----------
export async function review(req: any, res: any) {
  try {
    const { scope, reviewerId } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });
    const enrollment_id = req.body?.enrollment_id;
    const step_id = req.body?.step_id;
    const comment = req.body?.comment ? String(req.body.comment) : null;
    if (!enrollment_id || !step_id) return res.status(400).json({ ok: false, error: 'enrollment_id & step_id required' });
    const { data: target } = await supabase.from('enrollments').select('cohort_id').eq('id', enrollment_id).maybeSingle();
    if (!target || !scopeAllows(scope, target.cohort_id)) return res.status(403).json({ ok: false, error: 'no access' });
    await supabase.from('task_submissions').upsert({
      enrollment_id, step_id, reviewed: true, reviewer_id: reviewerId,
      review_comment: comment, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'enrollment_id,step_id' });
    return res.status(200).json({ ok: true, reviewed: true });
  } catch (e: any) { return res.status(401).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- POST grant-course (открыть/убрать мини-курс) ----------
export async function grantCourse(req: any, res: any) {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });
    const enrollment_id = req.body?.enrollment_id;
    if (!enrollment_id) return res.status(400).json({ ok: false, error: 'enrollment_id required' });
    const { data: target } = await supabase.from('enrollments').select('cohort_id').eq('id', enrollment_id).maybeSingle();
    if (!target || !scopeAllows(scope, target.cohort_id)) return res.status(403).json({ ok: false, error: 'no access' });
    const grant = !req.body?.revoke;
    await supabase.from('enrollments')
      .update({ bonus_course: grant, bonus_course_at: grant ? new Date().toISOString() : null })
      .eq('id', enrollment_id);
    return res.status(200).json({ ok: true, bonus_course: grant });
  } catch (e: any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- POST move-participant (перенос в другой поток) ----------
export async function moveParticipant(req: any, res: any) {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });
    const enrollment_id = req.body?.enrollment_id;
    const cohort_id = req.body?.cohort_id;
    if (!enrollment_id || !cohort_id) return res.status(400).json({ ok: false, error: 'enrollment_id & cohort_id required' });
    const { data: target } = await supabase.from('enrollments').select('cohort_id').eq('id', enrollment_id).maybeSingle();
    if (!target || !scopeAllows(scope, target.cohort_id)) return res.status(403).json({ ok: false, error: 'no access to source' });
    if (!scopeAllows(scope, cohort_id)) return res.status(403).json({ ok: false, error: 'no access to target' });
    await supabase.from('enrollments').update({ cohort_id }).eq('id', enrollment_id);
    return res.status(200).json({ ok: true, cohort_id });
  } catch (e: any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
}

// ---------- POST update-cohort (даты / приём открыт) ----------
export async function updateCohort(req: any, res: any) {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope.none) return res.status(403).json({ ok: false, error: 'not a curator' });
    const cohort_id = req.body?.cohort_id;
    if (!cohort_id) return res.status(400).json({ ok: false, error: 'cohort_id required' });
    if (!scopeAllows(scope, cohort_id)) return res.status(403).json({ ok: false, error: 'no access' });
    const patch: any = {};
    const b = req.body || {};
    if ('starts_on' in b) patch.starts_on = b.starts_on || null;
    if ('ends_on' in b) patch.ends_on = b.ends_on || null;
    if ('is_active' in b) patch.is_active = !!b.is_active;
    if ('schedule' in b) {
      const arr = Array.isArray(b.schedule) ? b.schedule : [];
      patch.schedule = arr
        .map((x: any) => ({ title: String(x?.title || '').slice(0, 200), at: String(x?.at || '').slice(0, 40), note: String(x?.note || '').slice(0, 300) }))
        .filter((x: any) => x.title || x.at);
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ ok: false, error: 'nothing to update' });
    const { error } = await supabase.from('cohorts').update(patch).eq('id', cohort_id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e: any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
}
