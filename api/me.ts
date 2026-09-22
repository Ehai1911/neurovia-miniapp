import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment, displayName } from './_lib/db';

export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);
    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        name: displayName(user),
        tg_id: user.telegram_user_id,
        role: enr?.role || 'student',
      },
      enrolled: !!enr,
      cohort: enr?.cohort ? { id: enr.cohort.id, title: enr.cohort.title } : null,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
