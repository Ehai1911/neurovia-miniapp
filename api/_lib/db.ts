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

// Доступ к курсу — ТОЛЬКО у зачисленных (оплата через Aksel или добавление админом).
// Гость (без зачисления) → null: приложение покажет Старт с замочками и кнопку оплаты.
export async function ensureEnrollment(userId: string) {
  return await getActiveEnrollment(userId);
}

export function displayName(user: any): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Участник';
}

// Какие потоки видит куратор/админ.
// dev (ALLOW_DEV_AUTH+admin=1) или роль admin → все потоки; curator → только свои.
export async function getAdminScope(req: any, userId: string): Promise<{ global?: boolean; cohortIds?: string[]; none?: boolean }> {
  const dev = process.env.ALLOW_DEV_AUTH === '1' && (req.query?.admin === '1' || req.body?.admin === '1');
  if (dev) return { global: true };
  const { data } = await supabase
    .from('enrollments').select('cohort_id, role').eq('user_id', userId).in('role', ['curator', 'admin']);
  const rows = data || [];
  if (rows.length === 0) return { none: true };
  if (rows.some((r: any) => r.role === 'admin')) return { global: true };
  return { cohortIds: rows.map((r: any) => r.cohort_id) };
}

export function scopeAllows(scope: any, cohortId: string): boolean {
  return !!scope.global || (scope.cohortIds || []).includes(cohortId);
}
