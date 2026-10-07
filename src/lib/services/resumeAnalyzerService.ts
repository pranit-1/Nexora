// ---------------------------------------------------------------------------
// Nexora Resume Intelligence — Elite ATS Resume Analyzer Service
// Based on Bob's implementation, adapted for Nexora (Next.js/TypeScript)
// ---------------------------------------------------------------------------
import { AIRouterService } from '../aiProviders';
import { extractText } from './documentReaderService';
import PDFDocument from 'pdfkit';

export interface Breakdown {
  impactAndMetrics: number;
  skillsRelevance: number;
  actionVerbs: number;
  formattingAndClarity: number;
  experienceDepth: number;
}

export interface BulletImprovement {
  original: string;
  improved: string;
}

export interface AuditResult {
  atsScore: number;
  verdict: 'Tier-1 Ready' | 'Strong Contender' | 'Needs Polish' | 'High Risk';
  breakdown: Breakdown;
  executiveSummary: string;
  strengths: string[];
  criticalNegatives: string[];
  atsKeywordsFound: string[];
  missingRecommendedKeywords: string[];
  bulletImprovements: BulletImprovement[];
  actionPlan: string[];
}

export interface AuditOptions {
  resumeText: string;
  targetJobDescription?: string;
}

export interface AuditBufferResult {
  analysis: AuditResult;
  fileName: string;
  charCount: number;
  pageCount: number | null;
}

function fixBareKeys(str: string): string {
  return str.replace(/([{,\[]\s*|^\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/gm,
    (_match, pre, key, colon) => `${pre}"${key}"${colon}`
  );
}

function cleanTrailingCommas(str: string): string {
  return str.replace(/,\s*([\]}])/g, '$1');
}

function tryRepairTruncatedJson(str: string): string {
  let s = str.trim();
  s = s.replace(/,\s*$/, '');
  s = s.replace(/:\s*$/, ': null');
  s = s.replace(/("[^"\\]*(?:\\.[^"\\]*)*)$/, '');
  s = s.replace(/,\s*$/, '');

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  if (inString) s += '"';
  s = cleanTrailingCommas(s);
  while (openBrackets > 0) {
    s += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    s += '}';
    openBraces--;
  }
  return cleanTrailingCommas(s);
}

function attemptParse(text: string | null): any {
  if (!text) return null;
  const candidates = [
    text,
    fixBareKeys(text),
    cleanTrailingCommas(text),
    cleanTrailingCommas(fixBareKeys(text)),
    tryRepairTruncatedJson(text),
    tryRepairTruncatedJson(fixBareKeys(text))
  ];
  for (const cand of candidates) {
    try {
      return JSON.parse(cand);
    } catch (_) {}
  }
  return null;
}

function getVerdict(score: number): AuditResult['verdict'] {
  if (score >= 85) return 'Tier-1 Ready';
  if (score >= 70) return 'Strong Contender';
  if (score >= 55) return 'Needs Polish';
  return 'High Risk';
}

function normalizeAudit(audit: any): AuditResult {
  const atsScore = Math.max(0, Math.min(100, Number(audit.atsScore) || 0));
  const verdict = audit.verdict || getVerdict(atsScore);
  const breakdown = audit.breakdown || {};
  return {
    atsScore,
    verdict,
    breakdown: {
      impactAndMetrics: Math.max(0, Math.min(100, Number(breakdown.impactAndMetrics) || 0)),
      skillsRelevance: Math.max(0, Math.min(100, Number(breakdown.skillsRelevance) || 0)),
      actionVerbs: Math.max(0, Math.min(100, Number(breakdown.actionVerbs) || 0)),
      formattingAndClarity: Math.max(0, Math.min(100, Number(breakdown.formattingAndClarity) || 0)),
      experienceDepth: Math.max(0, Math.min(100, Number(breakdown.experienceDepth) || 0)),
    },
    executiveSummary: typeof audit.executiveSummary === 'string' ? audit.executiveSummary : '',
    strengths: Array.isArray(audit.strengths) ? audit.strengths.filter((s: any) => typeof s === 'string') : [],
    criticalNegatives: Array.isArray(audit.criticalNegatives) ? audit.criticalNegatives.filter((s: any) => typeof s === 'string') : [],
    atsKeywordsFound: Array.isArray(audit.atsKeywordsFound) ? audit.atsKeywordsFound.filter((s: any) => typeof s === 'string') : [],
    missingRecommendedKeywords: Array.isArray(audit.missingRecommendedKeywords) ? audit.missingRecommendedKeywords.filter((s: any) => typeof s === 'string') : [],
    bulletImprovements: Array.isArray(audit.bulletImprovements)
      ? audit.bulletImprovements
          .filter((b: any) => b && typeof b.original === 'string' && typeof b.improved === 'string')
          .map((b: any) => ({ original: b.original, improved: b.improved }))
      : [],
    actionPlan: Array.isArray(audit.actionPlan) ? audit.actionPlan.filter((s: any) => typeof s === 'string') : [],
  };
}