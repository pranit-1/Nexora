// ---------------------------------------------------------------------------
// Performance Tracker — shared shapes.
//
// The tracker reads everything a student has stored (wallet documents, saved
// opportunities, profile) and asks the AI to produce a full, evidence-backed
// profile of the person: their honed skills, plus points, the gaps to close,
// which career lines fit them best, and how they would slot into each of the
// opportunities they have saved. These types are shared by the API route and
// the AI-hub UI so both agree on the payload.
// ---------------------------------------------------------------------------

export interface PerformanceTrait {
  name: string;
  /** 0-100 strength of this personality/work trait. */
  score: number;
  /** The wallet/profile evidence this judgement is based on. */
  evidence: string;
}

export interface PerformanceSkill {
  name: string;
  /** 0-100 demonstrated proficiency. */
  level: number;
  evidence: string;
}

export interface CareerPathFit {
  title: string;
  /** 0-100 fit for this career line. */
  fit: number;
  reason: string;
  steps: string[];
}

export interface RoleFit {
  opportunityId?: string;
  title: string;
  organization: string;
  category: string;
  /** 0-100 fit between the student and this saved opportunity. */
  fit: number;
  /** The specific role inside this opportunity that suits them best. */
  bestRole: string;
  reason: string;
  matchedSkills: string[];
  missingSkills: string[];
}

export interface PerformanceEvidenceDoc {
  document: string;
  highlight: string;
}

export interface PerformanceAssessment {
  /** 0-100 overall readiness/performance score. */
  overallScore: number;
  /** Short persona label, e.g. "Emerging Full-Stack Builder". */
  profileTitle: string;
  /** 2-3 sentence holistic summary of the person. */
  summary: string;
  traits: PerformanceTrait[];
  skills: PerformanceSkill[];
  /** "Plus points" — what is genuinely strong about this person. */
  plusPoints: string[];
  /** Honest gaps holding them back. */
  gaps: string[];
  /** Which lines/fields they can move into, best first. */
  careerPaths: CareerPathFit[];
  /** How they fit each opportunity they saved for later. */
  roleFit: RoleFit[];
  evidenceHighlights: PerformanceEvidenceDoc[];
  nextActions: string[];
  generatedAt?: string;
}

const SCORE_CAP = 100;

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return NaN;
}

function clampScore(v: unknown): number {
  const n = num(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(SCORE_CAP, Math.round(n))) : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown, max = 12): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, max)
    : [];
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Coerces whatever the model returned into a well-formed assessment. Anything
 * missing becomes an empty list rather than a crash, and every score is bounded
 * so the UI never has to defend against it.
 */
export function normalizePerformanceAssessment(raw: unknown): PerformanceAssessment {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const traits: PerformanceTrait[] = asArray(r.traits)
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name) || str(o.trait) || str(o.label),
        score: clampScore(o.score ?? o.level ?? o.value),
        evidence: str(o.evidence) || str(o.reason),
      };
    })
    .filter((t) => t.name)
    .slice(0, 10);

  const skills: PerformanceSkill[] = asArray(r.skills)
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name) || str(o.skill),
        level: clampScore(o.level ?? o.score ?? o.value),
        evidence: str(o.evidence) || str(o.reason),
      };
    })
    .filter((s) => s.name)
    .slice(0, 16);

  const careerPaths: CareerPathFit[] = asArray(r.careerPaths)
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        title: str(o.title) || str(o.field) || str(o.path),
        fit: clampScore(o.fit ?? o.score),
        reason: str(o.reason) || str(o.why),
        steps: strList(o.steps, 6),
      };
    })
    .filter((c) => c.title)
    .slice(0, 5);

  const roleFit: RoleFit[] = asArray(r.roleFit)
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        opportunityId: str(o.opportunityId) || undefined,
        title: str(o.title),
        organization: str(o.organization) || str(o.orgName),
        category: str(o.category),
        fit: clampScore(o.fit ?? o.score),
        bestRole: str(o.bestRole) || str(o.role),
        reason: str(o.reason),
        matchedSkills: strList(o.matchedSkills, 10),
        missingSkills: strList(o.missingSkills, 10),
      };
    })
    .filter((c) => c.title)
    .slice(0, 20);

  const evidenceHighlights: PerformanceEvidenceDoc[] = asArray(r.evidenceHighlights)
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return {
        document: str(o.document) || str(o.name),
        highlight: str(o.highlight) || str(o.note),
      };
    })
    .filter((e) => e.document || e.highlight)
    .slice(0, 10);

  return {
    overallScore: clampScore(r.overallScore ?? r.score),
    profileTitle: str(r.profileTitle) || str(r.persona) || str(r.title),
    summary: str(r.summary) || str(r.executiveSummary),
    traits,
    skills,
    plusPoints: strList(r.plusPoints, 12),
    gaps: strList(r.gaps ?? r.weaknesses ?? r.improvementAreas, 12),
    careerPaths,
    roleFit,
    evidenceHighlights,
    nextActions: strList(r.nextActions ?? r.actionPlan, 10),
    generatedAt: new Date().toISOString(),
  };
}
