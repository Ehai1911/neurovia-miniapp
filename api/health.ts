// Диагностика: сырой запрос к PostgREST, чтобы увидеть реальный статус/тело.
export default async function handler(_req: any, res: any) {
  const url = process.env.SUPABASE_URL as string;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const out: any = {
    env: {
      url_len: url?.length, key_len: key?.length, key_prefix: key?.slice(0, 3),
      bot: !!process.env.BOT_TOKEN,
    },
  };
  try {
    const r = await fetch(`${url}/rest/v1/courses?select=key`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Accept-Profile': 'miniapp',
      },
    });
    out.status = r.status;
    out.body = (await r.text()).slice(0, 800);
  } catch (e: any) {
    out.threw = String(e?.message || e);
  }
  return res.status(200).json(out);
}
