import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment } from './_lib/db';
import { supabase } from './_lib/supabase';

// POST { step_id, code } — отметка посещения по кодовому слову.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);
    if (!enr) return res.status(403).json({ ok: false, error: 'no enrollment' });

    const step_id = req.body?.step_id;
    const code = String(req.body?.code || '').trim().toLowerCase();
    if (!step_id) return res.status(400).json({ ok: false, error: 'step_id required' });
    if (!code) return res.status(400).json({ ok: false, error: 'Введите кодовое слово.' });

    const { data: step } = await supabase.from('steps').select('id,code_word').eq('id', step_id).single();
    if (!step || !step.code_word) return res.status(400).json({ ok: false, error: 'Для этого шага отметка не нужна.' });

    if (code !== String(step.code_word).trim().toLowerCase()) {
      return res.status(200).json({ ok: false, error: 'Неверное слово. Его называют в конце занятия.' });
    }

    await supabase.from('attendance').upsert({
      enrollment_id: enr.id, step_id, attended: true, code_entered: code,
      marked_at: new Date().toISOString(),
    }, { onConflict: 'enrollment_id,step_id' });

    return res.status(200).json({ ok: true, attended: true });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
