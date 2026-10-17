import { resolveAdmin } from './adminAccess';
import { supabase } from './supabase';

// Конструктор интенсива в кабинете куратора: интенсивы (courses), шаги (steps) и вопросы к заданиям (step_questions).
// Доступ — только куратор, вошедший по логину и паролю (scope.global).
// В базе удаление шага/вопроса каскадом стирает ответы, посещения и задания учеников,
// поэтому шаг или вопрос, по которым уже есть данные учеников, удалить нельзя — только переименовать или скрыть из программы.

const STEP_TYPES = ['intro', 'day', 'feedback', 'bonus'];
const STEP_FIELDS = 'id, course_key, position, type, title, description, code_word, tetrad_url, video_url, quiz_url, has_tasks';

async function requireGlobal(req: any, res: any): Promise<boolean> {
  try {
    const { scope } = await resolveAdmin(req);
    if (scope?.global) return true;
  } catch { /* нет входа */ }
  res.status(403).json({ ok: false, error: 'Нужен вход куратора по логину и паролю.' });
  return false;
}

const str = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
const url = (v: any) => {
  const s = str(v, 1000);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
};
const fail = (res: any, e: any) => res.status(500).json({ ok: false, error: String(e?.message || e) });

// Латиница из названия для ключа нового интенсива: «Спринт осень» → sprint-osen-x7k2
function makeKey(title: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  const base = title.toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'intensive';
  return base + '-' + Math.random().toString(36).slice(2, 6);
}

// Сколько данных учеников привязано к шагам (для запрета удаления и подсказки в кабинете)
async function stepUsage(stepIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!stepIds.length) return out;
  const tables = ['attendance', 'task_submissions', 'quiz_submissions', 'step_unlocks', 'recordings'];
  for (const t of tables) {
    const { data } = await supabase.from(t).select('step_id').in('step_id', stepIds);
    (data || []).forEach((r: any) => { out[r.step_id] = (out[r.step_id] || 0) + 1; });
  }
  const { data: qs } = await supabase.from('step_questions').select('id, step_id').in('step_id', stepIds);
  const qStep = new Map((qs || []).map((q: any) => [q.id, q.step_id]));
  if (qStep.size) {
    const { data: ans } = await supabase.from('task_answers').select('question_id').in('question_id', [...qStep.keys()]);
    (ans || []).forEach((a: any) => { const s = qStep.get(a.question_id); if (s) out[s] = (out[s] || 0) + 1; });
  }
  return out;
}

// ---------- GET program-courses → интенсивы со счётчиками ----------
export async function programCourses(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const [{ data: courses, error }, { data: steps }, { data: cohorts }] = await Promise.all([
      supabase.from('courses').select('key, title, open_all, created_at').order('created_at'),
      supabase.from('steps').select('course_key'),
      supabase.from('cohorts').select('course_key, is_active'),
    ]);
    if (error) throw error;
    const count = (rows: any[] | null, key: string, f?: (r: any) => boolean) =>
      (rows || []).filter((r) => r.course_key === key && (!f || f(r))).length;
    return res.status(200).json({
      ok: true,
      courses: (courses || []).map((c: any) => ({
        ...c,
        steps: count(steps, c.key),
        cohorts: count(cohorts, c.key),
        active_cohorts: count(cohorts, c.key, (r) => r.is_active),
      })),
    });
  } catch (e) { return fail(res, e); }
}

// ---------- POST program-course-save { key?, title, open_all? } → создать или изменить интенсив ----------
export async function programCourseSave(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const title = str(req.body?.title, 200);
    if (!title) return res.status(400).json({ ok: false, error: 'Укажите название интенсива.' });
    const openAll = req.body?.open_all === undefined ? undefined : !!req.body.open_all;
    const key = str(req.body?.key, 60);
    if (key) {
      const patch: any = { title };
      if (openAll !== undefined) patch.open_all = openAll;
      const { data, error } = await supabase.from('courses').update(patch).eq('key', key).select('key, title, open_all').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, error: 'Интенсив не найден.' });
      return res.status(200).json({ ok: true, course: data });
    }
    const { data, error } = await supabase.from('courses')
      .insert({ key: makeKey(title), title, open_all: openAll ?? false }).select('key, title, open_all').single();
    if (error) throw error;
    return res.status(200).json({ ok: true, course: data });
  } catch (e) { return fail(res, e); }
}

// ---------- GET program-steps ?course=key → шаги с вопросами и счётчиком данных учеников ----------
export async function programSteps(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const course = str(req.query?.course, 60);
    if (!course) return res.status(400).json({ ok: false, error: 'course required' });
    const { data: steps, error } = await supabase.from('steps')
      .select(STEP_FIELDS + ', step_questions(id, position, text)').eq('course_key', course).order('position');
    if (error) throw error;
    const usage = await stepUsage((steps || []).map((s: any) => s.id));
    const qIds = (steps || []).flatMap((s: any) => (s.step_questions || []).map((q: any) => q.id));
    const answered = new Set<string>();
    if (qIds.length) {
      const { data: ans } = await supabase.from('task_answers').select('question_id').in('question_id', qIds);
      (ans || []).forEach((a: any) => answered.add(a.question_id));
    }
    return res.status(200).json({
      ok: true,
      steps: (steps || []).map((s: any) => ({
        ...s,
        student_data: usage[s.id] || 0,
        questions: (s.step_questions || []).sort((a: any, b: any) => a.position - b.position)
          .map((q: any) => ({ id: q.id, text: q.text, has_answers: answered.has(q.id) })),
        step_questions: undefined,
      })),
    });
  } catch (e) { return fail(res, e); }
}

// ---------- POST program-step-save { id?, course_key, type, title, ..., questions: [{id?, text}] } ----------
export async function programStepSave(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const b = req.body || {};
    const course = str(b.course_key, 60);
    const type = str(b.type, 20);
    const title = str(b.title, 200);
    if (!course) return res.status(400).json({ ok: false, error: 'course_key required' });
    if (!STEP_TYPES.includes(type)) return res.status(400).json({ ok: false, error: 'Неизвестный тип шага.' });
    if (!title) return res.status(400).json({ ok: false, error: 'Укажите название шага.' });
    for (const k of ['tetrad_url', 'video_url', 'quiz_url']) {
      if (str(b[k], 1000) && !url(b[k])) return res.status(400).json({ ok: false, error: 'Ссылка должна начинаться с https:// — поле ' + k });
    }
    const row: any = {
      course_key: course, type, title,
      description: str(b.description, 20000) || null,
      code_word: str(b.code_word, 60) || null,
      tetrad_url: url(b.tetrad_url), video_url: url(b.video_url), quiz_url: url(b.quiz_url),
      has_tasks: !!b.has_tasks,
    };
    const questions: { id?: string; text: string }[] = Array.isArray(b.questions)
      ? b.questions.map((q: any) => ({ id: q?.id ? str(q.id, 60) : undefined, text: str(q?.text, 2000) })).filter((q: any) => q.text)
      : [];

    let stepId = str(b.id, 60);
    if (stepId) {
      const { data, error } = await supabase.from('steps').update(row).eq('id', stepId).eq('course_key', course).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, error: 'Шаг не найден.' });
    } else {
      const { data: last } = await supabase.from('steps').select('position').eq('course_key', course)
        .order('position', { ascending: false }).limit(1).maybeSingle();
      row.position = last ? Number(last.position) + 1 : 0;
      const { data, error } = await supabase.from('steps').insert(row).select('id').single();
      if (error) throw error;
      stepId = data.id;
    }

    // Вопросы: меняем текст существующих, добавляем новые; убранные удаляем, только если на них никто не отвечал.
    const { data: existing } = await supabase.from('step_questions').select('id').eq('step_id', stepId);
    const keep = new Set(questions.filter((q) => q.id).map((q) => q.id as string));
    const removed = (existing || []).map((q: any) => q.id).filter((id: string) => !keep.has(id));
    if (removed.length) {
      const { data: ans } = await supabase.from('task_answers').select('question_id').in('question_id', removed).limit(1);
      if (ans && ans.length) {
        return res.status(409).json({ ok: false, error: 'Шаг сохранён, но вопрос с ответами учеников удалить нельзя — его можно только переформулировать.', step_id: stepId });
      }
      const { error } = await supabase.from('step_questions').delete().in('id', removed);
      if (error) throw error;
    }
    // UNIQUE (step_id, position): оставшиеся вопросы сначала во временный диапазон, потом итоговые номера.
    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].id) continue;
      const { error } = await supabase.from('step_questions').update({ position: 1000 + i }).eq('id', questions[i].id).eq('step_id', stepId);
      if (error) throw error;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.id) {
        const { error } = await supabase.from('step_questions').update({ text: q.text, position: i }).eq('id', q.id).eq('step_id', stepId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('step_questions').insert({ step_id: stepId, text: q.text, position: i });
        if (error) throw error;
      }
    }
    return res.status(200).json({ ok: true, step_id: stepId });
  } catch (e) { return fail(res, e); }
}

// ---------- POST program-step-delete { id } — только если нет данных учеников ----------
export async function programStepDelete(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const id = str(req.body?.id, 60);
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const usage = await stepUsage([id]);
    if (usage[id]) {
      return res.status(409).json({ ok: false, error: 'По этому шагу уже есть данные учеников (ответы, посещения, задания) — удалить его нельзя.' });
    }
    const { error } = await supabase.from('steps').delete().eq('id', id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) { return fail(res, e); }
}

// ---------- POST program-steps-order { course_key, ids: [...] } → порядок шагов ----------
export async function programStepsOrder(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const course = str(req.body?.course_key, 60);
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => str(x, 60)) : [];
    if (!course || !ids.length) return res.status(400).json({ ok: false, error: 'course_key и ids обязательны' });
    const { data: steps } = await supabase.from('steps').select('id').eq('course_key', course);
    const own = new Set((steps || []).map((s: any) => s.id));
    if (ids.length !== own.size || ids.some((id) => !own.has(id))) {
      return res.status(400).json({ ok: false, error: 'Список шагов устарел — обновите страницу.' });
    }
    // В базе UNIQUE (course_key, position): сначала уводим номера во временный диапазон, потом ставим итоговые.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase.from('steps').update({ position: pass === 0 ? 1000 + i : i }).eq('id', ids[i]).eq('course_key', course);
        if (error) throw error;
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) { return fail(res, e); }
}

// ---------- POST program-cohort-create { course_key, title, starts_on?, ends_on? } → новый поток интенсива ----------
export async function programCohortCreate(req: any, res: any) {
  if (!(await requireGlobal(req, res))) return;
  try {
    const course = str(req.body?.course_key, 60);
    const title = str(req.body?.title, 200);
    if (!course || !title) return res.status(400).json({ ok: false, error: 'Укажите интенсив и название потока.' });
    const day = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v, 10)) ? str(v, 10) : null);
    const { data, error } = await supabase.from('cohorts')
      .insert({ course_key: course, title, starts_on: day(req.body?.starts_on), ends_on: day(req.body?.ends_on), is_active: true, schedule: [] })
      .select('id, title').single();
    if (error) throw error;
    return res.status(200).json({ ok: true, cohort: data });
  } catch (e) { return fail(res, e); }
}
