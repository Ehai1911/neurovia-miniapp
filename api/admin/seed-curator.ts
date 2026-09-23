import { hashPassword } from '../_lib/adminAuth';
import { supabase } from '../_lib/supabase';

// Разово создать демо-куратора. Работает только при ALLOW_DEV_AUTH=1.
// GET/POST ?login=&password=&name=
export default async function handler(req: any, res: any) {
  if (process.env.ALLOW_DEV_AUTH !== '1') return res.status(403).json({ ok: false, error: 'disabled' });
  try {
    const login = String(req.query?.login || req.body?.login || 'curator').trim().toLowerCase();
    const password = String(req.query?.password || req.body?.password || 'test123');
    const name = String(req.query?.name || req.body?.name || 'Куратор (демо)');
    const pass = hashPassword(password);
    const { data, error } = await supabase.from('curator_accounts')
      .upsert({ login, pass, name, is_admin: true }, { onConflict: 'login' })
      .select('login, name').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, account: data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
