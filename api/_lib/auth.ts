import { createHmac } from 'crypto';

export type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  language_code?: string;
};

// Проверка подписи Telegram initData (HMAC-SHA256 по токену бота).
// Личность берём ТОЛЬКО отсюда — никогда из тела запроса.
export function verifyInitData(initData: string): TgUser {
  const botToken = process.env.BOT_TOKEN as string;
  if (!botToken) throw new Error('BOT_TOKEN not set');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('no hash in initData');
  params.delete('hash');

  const pairs: string[] = [];
  const keys = Array.from(params.keys()).sort();
  for (const k of keys) pairs.push(`${k}=${params.get(k)}`);
  const dataCheck = pairs.join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (computed !== hash) throw new Error('bad initData signature');

  const userJson = params.get('user');
  if (!userJson) throw new Error('no user in initData');
  return JSON.parse(userJson) as TgUser;
}

// Достаём initData из запроса (тело/заголовок/квери) и валидируем.
// DEV-обход (только если ALLOW_DEV_AUTH=1): позволяет тестировать без Telegram.
export function getAuthedUser(req: any): TgUser {
  const initData =
    (req.body && req.body.initData) ||
    req.query?.initData ||
    req.headers?.['x-init-data'];

  if (initData) return verifyInitData(String(initData));

  if (process.env.ALLOW_DEV_AUTH === '1') {
    const id = Number(req.query?.tg || req.body?.tg || 100000001);
    return { id, first_name: 'Тест', username: 'dev_' + id };
  }
  throw new Error('no initData (open inside Telegram)');
}
