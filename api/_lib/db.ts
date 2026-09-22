import { supabase } from './supabase';
import type { TgUser } from './auth';

export const COURSE_KEY = 'neurovia_sprint';

export async function getOrCreateUser(tg: TgUser) {
  const { data: existing } = await supabase
    .from('users').select('*').eq('telegram_user_id', tg.id).maybeSingle();

  if (existing) {
    await supabase.from('users').update({
      username: tg.username, first_name: tg.first_name, last_name: tg.last_name,
      photo_url: tg.photo_url, language_code: tg.language_code,
      last_seen_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return existing;
  }
  const { data, error } = await supabase.from('users').insert({
    telegram_user_id: tg.id, username: tg.username, first_name: tg.first_name,
    last_name: tg.last_name, photo_url: tg.photo_url, language_code: tg.language_code,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getActiveEnrollment(userId: string) {
  const { data } = await supabase
    .from('enrollments')
    .select('*, cohort:cohorts(*)')
    .eq('user_id', userId).eq('status', 'active')
    .order('enrolled_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

// Пилот/тест: если зачисления нет — записываем в последний активный поток.
// (В проде заменить на enroll ТОЛЬКО по токену после оплаты в Акселе.)
export async function ensureEnrollment(userId: string) {
  const e = await getActiveEnrollment(userId);
  if (e) return e;
  const { data: cohort } = await supabase
    .from('cohorts').select('*').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!cohort) return null;
  const { data } = await supabase.from('enrollments')
    .insert({ user_id: userId, cohort_id: cohort.id, role: 'student', status: 'active' })
    .select('*, cohort:cohorts(*)').single();
  return data;
}

export function displayName(user: any): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Участник';
}
