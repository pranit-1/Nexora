import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/serverAuth';
import { buildAuditReportPdfBuffer, type AuditResult } from '@/lib/services/resumeAnalyzerService';

export const runtime = 'nodejs';

const VERDICTS: readonly string[] = [
  'Tier-1 Ready',
  'Strong Contender',
  'Needs Polish',
  'High Risk',
];

const MAX_LIST_ITEMS = 40;
const MAX_ITEM_CHARS = 500;
const MAX_SUMMARY_CHARS = 4000;
const MAX_FILE_NAME_CHARS = 100;

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, MAX_LIST_ITEMS)
    .map((item) => item.trim().slice(0, MAX_ITEM_CHARS))
    .filter(Boolean);
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function verdictFor(score: number): AuditResult['verdict'] {
  if (score >= 85) return 'Tier-1 Ready';
  if (score >= 70) return 'Strong Contender';
  if (score >= 55) return 'Needs Polish';
  return 'High Risk';
}

/**
 * The audit object arrives from the client (localStorage), so treat every
 * field as untrusted: coerce types, clamp scores and cap list sizes before
 * pdfkit renders it. Otherwise a malformed object crashes the render or a
 * caller ships unbounded content into the generated PDF.
 */
function sanitizeAudit(raw: unknown): AuditResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const atsScore = clampScore(input.atsScore);
  const rawBreakdown =
    input.breakdown && typeof input.breakdown === 'object' && !Array.isArray(input.breakdown)
      ? (input.breakdown as Record<string, unknown>)
      : {};
  const breakdown: AuditResult['breakdown'] = {
    impactAndMetrics: clampScore(rawBreakdown.impactAndMetrics),
    skillsRelevance: clampScore(rawBreakdown.skillsRelevance),
    actionVerbs: clampScore(rawBreakdown.actionVerbs),
    formattingAndClarity: clampScore(rawBreakdown.formattingAndClarity),
    experienceDepth: clampScore(rawBreakdown.experienceDepth),
  };

  const verdict = VERDICTS.includes(String(input.verdict))
    ? (input.verdict as AuditResult['verdict'])
    : verdictFor(atsScore);

  return {
    atsScore,
    verdict,
    breakdown,
    executiveSummary:
      typeof input.executiveSummary === 'string'
        ? input.executiveSummary.trim().slice(0, MAX_SUMMARY_CHARS)
        : '',
    strengths: strList(input.strengths),
    criticalNegatives: strList(input.criticalNegatives),
    atsKeywordsFound: strList(input.atsKeywordsFound),
    missingRecommendedKeywords: strList(input.missingRecommendedKeywords),
    bulletImprovements: [],
    actionPlan: strList(input.actionPlan),
  };
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    const audit = sanitizeAudit(body?.audit);
    if (!audit) {
      return NextResponse.json(
        { error: 'Audit data is required to generate report PDF.' },
        { status: 400 }
      );
    }
    const rawName =
      typeof body?.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim().slice(0, MAX_FILE_NAME_CHARS)
        : 'Resume';

    const buffer = await buildAuditReportPdfBuffer(audit, rawName);
    const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'Resume';
    const response = new NextResponse(buffer as any);
    response.headers.set('Content-Type', 'application/pdf');
    response.headers.set('Content-Disposition', `attachment; filename="${safeName}_ATS_Report.pdf"`);
    response.headers.set('Content-Length', buffer.length.toString());
    return response;
  } catch (err) {
    console.error('[ResumeAPI] Download audit PDF error:', err);
    // Never surface internal error details (pdfkit paths etc.) to the caller.
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
