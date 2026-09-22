import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment } from './_lib/db';
import { supabase } from './_lib/supabase';

// POST { step_id, answers: { [question_id]: text } } — сохранить ответы задания дня.
// Когда все вопросы шага заполнены — помечаем task_submissions.completed = true.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);
    if (!enr) return res.status(403).json({ ok: false, error: 'no enrollment' });

    const step_id = req.body?.step_id;
    const answers = req.body?.answers || {};
    if (!step_id) return res.status(400).json({ ok: false, error: 'step_id required' });

    const { data: questions } = await supabase
      .from('step_questions').select('id').eq('step_id', step_id);
    const qIds = (questions || []).map((q: any) => q.id);
    if (qIds.length === 0) return res.status(400).json({ ok: false, error: 'no questions' });

    const rows = qIds
      .filter((qid: string) => String(answers[qid] || '').trim().length > 0)
      .map((qid: string) => ({
        enrollment_id: enr.id, question_id: qid,
        answer_text: String(answers[qid]).trim(), updated_at: new Date().toISOString(),
      }));

    if (rows.length > 0) {
      await supabase.from('task_answers').upsert(rows, { onConflict: 'enrollment_id,question_id' });
    }

    const allAnswered = qIds.every((qid: string) => String(answers[qid] || '').trim().length > 0);
    if (!allAnswered) {
      return res.status(200).json({ ok: false, error: 'Ответьте на все три вопроса.', saved: rows.length });
    }

    await supabase.from('task_submissions').upsert({
      enrollment_id: enr.id, step_id, completed: true,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'enrollment_id,step_id' });

    return res.status(200).json({ ok: true, completed: true });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
