// ---------------------------------------------------------------------------
// Nexora Resume Intelligence — Elite ATS Resume Analyzer Service
// Based on Bob's implementation, adapted for Nexora (Next.js/TypeScript)
// ---------------------------------------------------------------------------
import { AIRouterService } from '../aiProviders';
import { extractText } from './documentReaderService';
import PDFDocument from 'pdfkit';

function callAI(prompt: string): Promise<any> {
  return AIRouterService.requestAI(prompt, true);
}

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

export async function auditResume(options: AuditOptions): Promise<AuditResult> {
  const { resumeText, targetJobDescription = '' } = options;
  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error('Resume content is too short or empty to analyze.');
  }

  const prompt = `You are a Principal Tech Recruiter and Merciless Fortune 500 ATS Auditor. Perform a deep, strict, zero-leniency review. Return ONLY a valid JSON object with this structure:
{
  "atsScore": <integer 0-100>,
  "verdict": "<Tier-1 Ready | Strong Contender | Needs Polish | High Risk>",
  "breakdown": {
    "impactAndMetrics": <integer 0-100>,
    "skillsRelevance": <integer 0-100>,
    "actionVerbs": <integer 0-100>,
    "formattingAndClarity": <integer 0-100>,
    "experienceDepth": <integer 0-100>
  },
  "executiveSummary": "<2-3 sentences>",
  "strengths": ["<strength>"],
  "criticalNegatives": ["<weakness>"],
  "atsKeywordsFound": ["<keyword>"],
  "missingRecommendedKeywords": ["<keyword>"],
  "bulletImprovements": [{ "original": "<bullet>", "improved": "<rewrite>" }],
  "actionPlan": ["<step>"]
}

RESUME:
"""
${resumeText.slice(0, 25000)}
"""

${targetJobDescription ? `TARGET JOB:\n"""\n${targetJobDescription.slice(0, 10000)}\n"""` : ''}`;

  const response = await callAI(prompt);
  const rawText = typeof response === 'string' ? response : JSON.stringify(response);
  let cleaned = rawText.replace(/^﻿/, '').replace(/[​-‍﻿ ]/g, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();

  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`Failed to parse ATS analysis. Snippet: ${rawText.slice(0, 200)}`);
  }

  const parsed = attemptParse(cleaned.slice(startIdx, endIdx + 1));
  if (parsed && typeof parsed === 'object') {
    return normalizeAudit(parsed);
  }

  const scoreMatch = cleaned.match(/"atsScore"\s*:\s*(\d+)/);
  if (scoreMatch) {
    const fallbackScore = Number(scoreMatch[1]) || 80;
    return normalizeAudit({ atsScore: fallbackScore });
  }

  throw new Error(`Audit JSON parse failed. Snippet: ${cleaned.slice(0, 240)}`);
}

export async function auditResumeBuffer(
  fileBuffer: Buffer,
  originalName: string,
  targetJobDescription = ''
): Promise<AuditBufferResult> {
  const extraction = await extractText(fileBuffer, originalName);
  if (!extraction || !extraction.text || extraction.text.trim().length < 50) {
    throw new Error(extraction?.error || 'Could not extract readable text from this file.');
  }

  const analysis = await auditResume({ resumeText: extraction.text, targetJobDescription });
  return {
    analysis,
    fileName: originalName,
    charCount: extraction.text.length,
    pageCount: extraction.pageCount || 1,
  };
}

export function buildAuditReportPdfBuffer(audit: AuditResult, resumeFileName = 'Resume'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 45, right: 45 } });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err: Error) => reject(err));

      const scoreColor = audit.atsScore >= 85 ? '#10b981' : audit.atsScore >= 70 ? '#f59e0b' : '#ef4444';
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('ATS Resume Audit Report', { align: 'center' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#64748b').text(`Document: ${resumeFileName}  |  Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(0.8);

      doc.font('Helvetica-Bold').fontSize(26).fillColor(scoreColor).text(`${audit.atsScore}%`, 45, doc.y);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(`VERDICT: ${audit.verdict}`, 140, doc.y - 30);
      doc.moveDown(2);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Executive Summary');
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(audit.executiveSummary || 'No summary available.');
      doc.moveDown(1);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Breakdown');
      const labels: Record<string, string> = {
        impactAndMetrics: 'Impact & Metrics',
        skillsRelevance: 'Skills Relevance',
        actionVerbs: 'Action Verbs',
        formattingAndClarity: 'Formatting & Clarity',
        experienceDepth: 'Experience Depth',
      };
      for (const [k, v] of Object.entries(audit.breakdown)) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`${labels[k] || k}: `, { continued: true });
        doc.font('Helvetica').fillColor('#334155').text(`${v}%`);
      }
      doc.moveDown(1);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Strengths');
      audit.strengths.forEach((s) => doc.font('Helvetica').fontSize(9).fillColor('#059669').text(`  • ${s}`));
      doc.moveDown(1);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Critical Negatives');
      audit.criticalNegatives.forEach((n) => doc.font('Helvetica').fontSize(9).fillColor('#dc2626').text(`  • ${n}`));
      doc.moveDown(1);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Action Plan');
      audit.actionPlan.forEach((step, i) => doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`  ${i + 1}. ${step}`));

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}