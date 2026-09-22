import { supabase } from './_lib/supabase';

// Проверочный эндпоинт: подтверждает, что env-переменные заданы,
// подключение к Supabase (схема miniapp) работает и данные на месте.
export default async function handler(_req: any, res: any) {
  try {
    const hasUrl = !!process.env.SUPABASE_URL;
    const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const hasBot = !!process.env.BOT_TOKEN;

    const courses = await supabase.from('courses').select('*', { count: 'exact', head: true });
    const steps = await supabase.from('steps').select('*', { count: 'exact', head: true });
    const questions = await supabase.from('step_questions').select('*', { count: 'exact', head: true });

    if (courses.error || steps.error || questions.error) {
      return res.status(500).json({
        ok: false,
        env: { SUPABASE_URL: hasUrl, SUPABASE_SERVICE_ROLE_KEY: hasKey, BOT_TOKEN: hasBot },
        error: courses.error?.message || steps.error?.message || questions.error?.message,
      });
    }

    return res.status(200).json({
      ok: true,
      env: { SUPABASE_URL: hasUrl, SUPABASE_SERVICE_ROLE_KEY: hasKey, BOT_TOKEN: hasBot },
      db: 'miniapp',
      counts: { courses: courses.count, steps: steps.count, questions: questions.count },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
