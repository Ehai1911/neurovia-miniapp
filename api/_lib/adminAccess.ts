import { getAdminFromToken } from './adminAuth';
import { getAuthedUser } from './auth';
import { getOrCreateUser, getAdminScope } from './db';

// Единая точка доступа к админ-эндпоинтам:
//  1) сессия куратора (логин/пароль) → scope global;
//  2) иначе — Telegram initData/dev + роль в enrollments.
// reviewerId — users.id (для отметки «принято»); у логин-куратора его нет → null.
export async function resolveAdmin(req: any): Promise<{ scope: any; reviewerId: string | null; account?: any }> {
  const claims = getAdminFromToken(req);
  if (claims) return { scope: { global: true }, reviewerId: null, account: claims };

  const tg = getAuthedUser(req); // бросит, если нет ни токена, ни initData/dev
  const me = await getOrCreateUser(tg);
  const scope = await getAdminScope(req, me.id);
  return { scope, reviewerId: me.id };
}
