import * as H from '../_lib/adminHandlers';
import * as P from '../_lib/programHandlers';

// Один динамический роут на все админ-действия (экономим лимит функций Vercel).
// /api/admin/cohorts | participants | participant | review | login
const MAP: Record<string, (req: any, res: any) => Promise<any>> = {
  'login': H.login,
  'cohorts': H.cohorts,
  'participants': H.participants,
  'participant': H.participant,
  'review': H.review,
  'grant-course': H.grantCourse,
  'move-participant': H.moveParticipant,
  'update-cohort': H.updateCohort,
  'support': H.support,
  'support-resolve': H.supportResolve,
  'support-reply': H.supportReply,
  // конструктор интенсива
  'program-courses': P.programCourses,
  'program-course-save': P.programCourseSave,
  'program-steps': P.programSteps,
  'program-step-save': P.programStepSave,
  'program-step-delete': P.programStepDelete,
  'program-steps-order': P.programStepsOrder,
  'program-cohort-create': P.programCohortCreate,
};

export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || '');
  const fn = MAP[action];
  if (!fn) return res.status(404).json({ ok: false, error: 'unknown admin action: ' + action });
  return fn(req, res);
}
