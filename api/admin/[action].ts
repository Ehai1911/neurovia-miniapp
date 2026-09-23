import * as H from '../_lib/adminHandlers';

// Один динамический роут на все админ-действия (экономим лимит функций Vercel).
// /api/admin/cohorts | participants | participant | review | login | seed-curator
const MAP: Record<string, (req: any, res: any) => Promise<any>> = {
  'login': H.login,
  'seed-curator': H.seedCurator,
  'cohorts': H.cohorts,
  'participants': H.participants,
  'participant': H.participant,
  'review': H.review,
  'grant-course': H.grantCourse,
  'move-participant': H.moveParticipant,
  'update-cohort': H.updateCohort,
};

export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || '');
  const fn = MAP[action];
  if (!fn) return res.status(404).json({ ok: false, error: 'unknown admin action: ' + action });
  return fn(req, res);
}
