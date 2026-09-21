// Background batch summarizer: pre-computes AI summaries for every stored
// scraped opportunity and persists them to the summaries store, so the
// explore popup is instant (cache hit) instead of calling AI on each click.
// Runs side-by-side with the website (startup + cron + /api/summarize-all).

import { AIRouterService } from "@/lib/aiProviders";
import { readStore } from "./scrapedStore";
import { getCachedSummary, saveSummary } from "./summariesStore";

const CONCURRENCY = 3;

export interface BatchSummaryStats {
  processed: number;
  aiCalls: number;
  saved: number;
  cachedSkipped: number;
  failed: number;
  errors: string[];
  totalStored: number;
  totalSummarized: number;
}

function buildPrompt(o: any): string {
  const title = o.title || "";
  const orgName = o.orgName || "";
  const category = o.category || "";
  const deadline = o.deadline || "";
  const country = o.country || "";
  const field = o.field || "";
  const eligibility = o.eligibility || "";
  const url = o.applyLink || o.sourceUrl || "";
  const description = (o.description || "").slice(0, 2500);

  return `You are NEXORA's opportunity explainer. Summarize the opportunity described below into a proper easy-to-understand format so any student can understand what is happening.

RULES:
- Use simple, friendly language (no jargon)
- Structure EXACTLY like this (use markdown headings):
## Quick Summary
2-3 lines what this opportunity is.

## What it's about
4-6 sentences covering purpose, what you will do/learn, mode (online/offline), etc.

## Who can apply
Bullet list of eligibility (who is allowed, degree, year, gender if any).

## Benefits / Prizes / Support
Bullet list.

## Important Dates & Location
- Deadline:
- Location / Mode:
- Other dates if found:

## How to Apply
Numbered steps 1-4 in simple words.

## Main Facts (at the very end)
Bullet list of 5-8 key facts the user MUST know (most important info compressed). This section MUST be last.

If any info is not found, write "Check official page" rather than guessing. Keep total under 450 words.

OPPORTUNITY DETAILS:
Title="${title}"
Organization="${orgName}"
Category="${category}"
Deadline="${deadline}"
Country="${country}"
Field="${field}"
Eligibility="${eligibility}"
URL="${url}"

DESCRIPTION:
"""
${description}
"""`;
}

async function summarizeOne(o: any): Promise<string> {
  const prompt = buildPrompt(o);
  const summary = await AIRouterService.requestAI(prompt, false);
  const text = typeof summary === "string" ? summary : JSON.stringify(summary);
  if (!text || text.trim().length < 50) throw new Error("Empty AI output");
  return text.trim();
}

/** Processes stored opportunities that lack a fresh summary. */
export async function summarizePendingOpportunities(
  opts: { limit?: number; force?: boolean } = {},
  onProgress?: (done: number, total: number) => void
): Promise<BatchSummaryStats> {
  const store = readStore();
  const opps: any[] = (store?.opportunities as any[]) || [];
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 15;
  const force = !!opts.force;

  const toProcess = opps.filter((o: any) => {
    const applyLink = (o.applyLink || o.sourceUrl || "") as string;
    if (!applyLink) return false;
    if (!force && getCachedSummary(applyLink)) return false;
    return true;
  }).slice(0, limit);

  let saved = 0;
  let failed = 0;
  let aiCalls = 0;
  const errors: string[] = [];

  const results: { ok: boolean }[] = new Array(toProcess.length).fill({ ok: false, err: "" } as any);
  let index = 0;

  async function worker() {
    while (index < toProcess.length) {
      const i = index++;
      const o = toProcess[i];
      const applyLink = (o.applyLink || o.sourceUrl || "") as string;
      const title = (o.title || "") as string;
      const orgName = (o.orgName || "") as string;
      try {
        const summary = await summarizeOne(o);
        aiCalls++;
        saveSummary(applyLink, { summary, provider: "openrouter-key1", title, orgName });
        saved++;
        results[i] = { ok: true };
      } catch (err: any) {
        results[i] = { ok: false } as any;
        failed++;
        errors.push(`${title.slice(0, 30)}: ${(err.message || "AI failed").slice(0, 70)}`);
      }
      if (onProgress) onProgress(saved + failed, toProcess.length);
    }
  }

  const workerCount = Math.min(CONCURRENCY, toProcess.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const summarized = opps.filter((o: any) => !!getCachedSummary(o.applyLink || o.sourceUrl || "")).length;

  return {
    processed: toProcess.length,
    aiCalls,
    saved,
    cachedSkipped: opps.length - toProcess.length,
    failed,
    errors: errors.slice(0, 20),
    totalStored: opps.length,
    totalSummarized: summarized,
  };
}