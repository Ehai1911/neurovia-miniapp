import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// Пароли храним как salt:hash (scrypt) — открытого пароля в БД НЕТ.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const hash = Buffer.from(hashHex, 'hex');
    const test = scryptSync(pw, salt, 64);
    return hash.length === test.length && timingSafeEqual(hash, test);
  } catch { return false; }
}

function b64url(s: Buffer | string) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

// Сессия куратора — подписанный HMAC-токен (без внешних библиотек).
export function signToken(payload: any, ttlSec = 60 * 60 * 12): string {
  const secret = process.env.ADMIN_JWT_SECRET as string;
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const p = b64url(JSON.stringify(body));
  const sig = b64url(createHmac('sha256', secret).update(p).digest());
  return p + '.' + sig;
}
export function verifyToken(token: string): any | null {
  try {
    const secret = process.env.ADMIN_JWT_SECRET as string;
    if (!secret) return null;
    const [p, sig] = String(token).split('.');
    if (!p || !sig) return null;
    const expect = b64url(createHmac('sha256', secret).update(p).digest());
    if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const body = JSON.parse(fromB64url(p));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch { return null; }
}

export function getAdminFromToken(req: any): any | null {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query?.admtoken || '');
  if (!token) return null;
  return verifyToken(String(token));
}
