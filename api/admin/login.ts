import { verifyPassword, signToken } from '../_lib/adminAuth';
import { supabase } from '../_lib/supabase';

// POST { login, password } — вход куратора → сессионный токен.
export default async function handler(req: any, res: any) {
  try {
    const login = String(req.body?.login || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!login || !password) return res.status(400).json({ ok: false, error: 'Введите логин и пароль.' });
    if (!process.env.ADMIN_JWT_SECRET) return res.status(500).json({ ok: false, error: 'ADMIN_JWT_SECRET not set' });

    const { data: acc } = await supabase.from('curator_accounts').select('*').eq('login', login).maybeSingle();
    if (!acc || !verifyPassword(password, acc.pass)) {
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль.' });
    }
    const token = signToken({ sub: acc.id, login: acc.login, is_admin: acc.is_admin, name: acc.name });
    return res.status(200).json({ ok: true, token, name: acc.name || acc.login });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
