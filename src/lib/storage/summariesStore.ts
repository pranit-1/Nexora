// Persistent store for AI-generated opportunity summaries.
// Keyed by normalized source URL so repeat clicks are instant
// and summaries survive restarts without re-scraping / re-asking AI.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const STORAGE_DIR = join(process.cwd(), "storage");
const SUMMARIES_PATH = join(STORAGE_DIR, "scraped-summaries.json");

// Re-summarize after this many days (freshness).
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface SummaryEntry {
  url: string;
  normalizedUrl: string;
  summary: string;
  provider: string;
  title: string;
  orgName: string;
  createdAt: string;
}

function readAll(): SummaryEntry[] {
  try {
    if (!existsSync(SUMMARIES_PATH)) return [];
    const data = JSON.parse(readFileSync(SUMMARIES_PATH, "utf-8"));
    return Array.isArray(data) ? data : data.summaries || [];
  } catch {
    return [];
  }
}

function writeAll(entries: SummaryEntry[]) {
  try {
    if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
    writeFileSync(SUMMARIES_PATH, JSON.stringify({ summaries: entries }, null, 2), "utf-8");
  } catch (err: any) {
    console.warn("[summaries-store] write failed:", err.message);
  }
}

export function normalizeSummaryKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Returns a fresh cached summary for the url, or null. */
export function getCachedSummary(url: string): SummaryEntry | null {
  const key = normalizeSummaryKey(url);
  const entries = readAll();
  const found = entries.find((e) => e.normalizedUrl === key);
  if (!found) return null;
  const age = Date.now() - new Date(found.createdAt).getTime();
  if (age > MAX_AGE_MS) return null;
  return found;
}

/** Saves/updates the cached summary for a url. */
export function saveSummary(url: string, entry: { summary: string; provider: string; title: string; orgName: string }) {
  const normalizedUrl = normalizeSummaryKey(url);
  const entries = readAll().filter((e) => e.normalizedUrl !== normalizedUrl);
  entries.unshift({
    url,
    normalizedUrl,
    summary: entry.summary,
    provider: entry.provider,
    title: entry.title,
    orgName: entry.orgName,
    createdAt: new Date().toISOString(),
  });
  // keep bounded
  writeAll(entries.slice(0, 500));
}

export function getSummaryCount(): number {
  return readAll().length;
}