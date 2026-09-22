import { supabase } from './_lib/supabase';

function scan(v: string | undefined) {
  if (!v) return { present: false };
  let badIndex = -1, badCode = -1;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c > 255) { badIndex = i; badCode = c; break; }
  }
  const prefix = v.slice(0, 3);
  return { present: true, length: v.length, prefix, badIndex, badCode };
}

export default async function handler(_req: any, res: any) {
  const env = {
    SUPABASE_URL: scan(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: scan(process.env.SUPABASE_SERVICE_ROLE_KEY),
    BOT_TOKEN: scan(process.env.BOT_TOKEN),
  };
  try {
    const courses = await supabase.from('courses').select('*', { count: 'exact', head: true });
    const steps = await supabase.from('steps').select('*', { count: 'exact', head: true });
    const questions = await supabase.from('step_questions').select('*', { count: 'exact', head: true });

    if (courses.error || steps.error || questions.error) {
      return res.status(500).json({
        ok: false, env,
        errors: {
          courses: courses.error,
          steps: steps.error,
          questions: questions.error,
        },
      });
    }
    return res.status(200).json({
      ok: true, env, db: 'miniapp',
      counts: { courses: courses.count, steps: steps.count, questions: questions.count },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, env, threw: String(e?.message || e) });
  }
}
