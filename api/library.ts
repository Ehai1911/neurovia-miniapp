import { getAuthedUser } from './_lib/auth';
import { getOrCreateUser, ensureEnrollment } from './_lib/db';
import { supabase } from './_lib/supabase';

// Библиотека: записи ТОЛЬКО своего потока и только опубликованные.
export default async function handler(req: any, res: any) {
  try {
    const tg = getAuthedUser(req);
    const user = await getOrCreateUser(tg);
    const enr = await ensureEnrollment(user.id);
    if (!enr) return res.status(200).json({ ok: true, recordings: [] });

    const { data } = await supabase
      .from('recordings')
      .select('id, video_url, title, is_published, step:steps(title, position)')
      .eq('cohort_id', enr.cohort_id)
      .eq('is_published', true);

    const recordings = (data || [])
      .map((r: any) => ({
        id: r.id,
        title: r.title || r.step?.title || 'Запись',
        position: r.step?.position ?? 99,
        video_url: r.video_url,
      }))
      .sort((a: any, b: any) => a.position - b.position);

    return res.status(200).json({ ok: true, recordings });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
}
