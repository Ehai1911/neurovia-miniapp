import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, getActiveEnrollment } from './_lib/db';
import { supabase } from './_lib/supabase';

// POST { token } — вход по ссылке после оплаты в Акселе.
// Одноразовый токен → зачисление в нужный поток.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);

    const token = String(req.body?.token || req.query?.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token required' });

    const already = await getActiveEnrollment(user.id);
    if (already) return res.status(200).json({ ok: true, enrolled: true, cohort_id: already.cohort_id, note: 'already enrolled' });

    const { data: invite } = await supabase
      .from('enroll_invites').select('*').eq('token', token).eq('status', 'active').maybeSingle();
    if (!invite) return res.status(404).json({ ok: false, error: 'Ссылка недействительна или уже использована.' });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await supabase.from('enroll_invites').update({ status: 'expired' }).eq('id', invite.id);
      return res.status(410).json({ ok: false, error: 'Срок ссылки истёк.' });
    }

    const { data: enr, error } = await supabase.from('enrollments').insert({
      user_id: user.id, cohort_id: invite.cohort_id, role: 'student', status: 'active',
      external_ref: invite.external_ref,
    }).select().single();
    if (error) throw error;

    await supabase.from('enroll_invites').update({
      status: 'used', used_by: enr.id, used_at: new Date().toISOString(),
    }).eq('id', invite.id);

    return res.status(200).json({ ok: true, enrolled: true, cohort_id: invite.cohort_id });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
