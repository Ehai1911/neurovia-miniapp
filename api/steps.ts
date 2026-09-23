import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment, COURSE_KEY } from './_lib/db';
import { supabase } from './_lib/supabase';

export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);

    const { data: steps, error } = await supabase
      .from('steps')
      .select('*, step_questions(*)')
      .eq('course_key', COURSE_KEY)
      .order('position');
    if (error) throw error;

    let attSet = new Set<string>();
    let taskMap = new Map<string, boolean>();
    let ansMap = new Map<string, string>();
    let feedback: any = null;

    if (enr) {
      const eid = enr.id;
      const [att, tasks, answers, fb] = await Promise.all([
        supabase.from('attendance').select('step_id,attended').eq('enrollment_id', eid),
        supabase.from('task_submissions').select('step_id,completed').eq('enrollment_id', eid),
        supabase.from('task_answers').select('question_id,answer_text').eq('enrollment_id', eid),
        supabase.from('feedback_submissions').select('*').eq('enrollment_id', eid).maybeSingle(),
      ]);
      (att.data || []).forEach((a: any) => { if (a.attended) attSet.add(a.step_id); });
      (tasks.data || []).forEach((t: any) => taskMap.set(t.step_id, t.completed));
      (answers.data || []).forEach((a: any) => ansMap.set(a.question_id, a.answer_text));
      feedback = fb.data;
    }

    const { data: settingsRows } = await supabase.from('app_settings').select('key,value');
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => { settings[r.key] = r.value; });

    const days = (steps || []).filter((s: any) => s.type === 'day');
    const allDaysDone = days.length > 0 && days.every((d: any) => taskMap.get(d.id) === true);

    const result: any[] = [];
    let prevDone = true; // intro считается «пройденным» для гейта первого дня
    for (const s of steps || []) {
      let available = true;
      if (s.type === 'day') available = prevDone;
      else if (s.type === 'feedback') available = allDaysDone;
      else if (s.type === 'bonus') available = allDaysDone;

      const done = taskMap.get(s.id) === true;
      const questions = (s.step_questions || [])
        .sort((a: any, b: any) => a.position - b.position)
        .map((q: any) => ({ id: q.id, position: q.position, text: q.text, answer: ansMap.get(q.id) || '' }));

      result.push({
        id: s.id, type: s.type, position: s.position, title: s.title,
        description: s.description, video_url: s.video_url, quiz_url: s.quiz_url,
        tetrad_url: s.tetrad_url, code_required: !!s.code_word,
        has_tasks: s.has_tasks, available, attended: attSet.has(s.id), done, questions,
      });

      if (s.type === 'day') prevDone = done;
    }

    return res.status(200).json({
      ok: true,
      enrolled: !!enr,
      cohort: enr?.cohort ? { id: enr.cohort.id, title: enr.cohort.title } : null,
      schedule: enr?.cohort?.schedule || [],
      role: enr?.role || 'student',
      steps: result,
      settings,
      bonus_course: !!enr?.bonus_course,
      feedback: feedback ? { kind: feedback.kind } : null,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
