import { supabase } from './_lib/supabase';

// Веб-хук Акселя: вызывается ПОСЛЕ оплаты. Создаёт одноразовое приглашение (enroll_invites)
// на нужный поток. Аксель сам генерит token (#Function.NewGuid36#) и тем же токеном
// формирует ссылку t.me/<bot>?startapp=<token>. Поток выбираем ЗДЕСЬ по дате.
//
// Приходящие поля (в query ИЛИ body): secret, token, email, order.
// Доступ: secret === AKSEL_WEBHOOK_SECRET (или dev при ALLOW_DEV_AUTH=1).
//
// Правило выбора потока (реш. Эльвиры):
//  • если сейчас идёт поток (starts_on <= сегодня <= ends_on) → в ТЕКУЩИЙ идущий;
//  • иначе → ближайший будущий (min starts_on >= сегодня);
//  • иначе → последний активный (fallback).

const HOUR = 3600 * 1000;

function pick(req: any, k: string): string {
  return String((req.body && req.body[k]) ?? req.query?.[k] ?? '').trim();
}

export default async function handler(req: any, res: any) {
  try {
    const secret = pick(req, 'secret');
    const need = process.env.AKSEL_WEBHOOK_SECRET;
    const dev = process.env.ALLOW_DEV_AUTH === '1' && req.query?.dev === '1';
    if (!dev && (!need || secret !== need)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const token = pick(req, 'token');
    const email = pick(req, 'email');
    const order = pick(req, 'order');
    if (!token) return res.status(400).json({ ok: false, error: 'token required' });

    // Идемпотентность: если приглашение с таким токеном уже есть — вернуть его.
    const { data: existing } = await supabase.from('enroll_invites').select('id, cohort_id, status').eq('token', token).maybeSingle();
    if (existing) return res.status(200).json({ ok: true, cohort_id: existing.cohort_id, note: 'already exists' });

    const today = new Date(Date.now() + 5 * HOUR).toISOString().slice(0, 10); // Алматы, YYYY-MM-DD

    const { data: cohorts } = await supabase.from('cohorts')
      .select('id, title, starts_on, ends_on, created_at').eq('is_active', true);
    const list = cohorts || [];
    if (list.length === 0) return res.status(409).json({ ok: false, error: 'нет активных потоков' });

    const running = list.filter((c: any) => c.starts_on && c.ends_on && c.starts_on <= today && today <= c.ends_on)
      .sort((a: any, b: any) => (a.starts_on < b.starts_on ? 1 : -1)); // самый поздний старт первым
    const future = list.filter((c: any) => c.starts_on && c.starts_on >= today)
      .sort((a: any, b: any) => (a.starts_on > b.starts_on ? 1 : -1)); // самый ранний старт первым
    const fallback = [...list].sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1)); // новейший

    const chosen = running[0] || future[0] || fallback[0];

    // Срок ссылки: до конца потока (+1 день) или +30 дней, если конец не задан.
    const expires = chosen.ends_on
      ? new Date(new Date(chosen.ends_on + 'T23:59:59+05:00').getTime() + 24 * HOUR).toISOString()
      : new Date(Date.now() + 30 * 24 * HOUR).toISOString();

    const { error } = await supabase.from('enroll_invites').insert({
      token, cohort_id: chosen.id, external_ref: order || null, buyer_email: email || null,
      status: 'active', expires_at: expires,
    });
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, cohort: chosen.title, cohort_id: chosen.id, expires_at: expires });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
