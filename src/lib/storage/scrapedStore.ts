// ─── Persistent storage for scraped opportunities ───────────────────
// Stores all scraped data in storage/scraped-opportunities.json so we don't
// re-scrape on every change. Includes expiry filtering (pending keep, expired remove)
// and capping at 400.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { ScrapedOpportunity } from "@/lib/ingestion/scrapers/types";

const STORAGE_DIR = join(process.cwd(), "storage");
const STORAGE_FILE = join(STORAGE_DIR, "scraped-opportunities.json");
export const MAX_STORED = 400;

export interface StoredData {
  generatedAt: string;
  lastScrapeAt: string;
  lastExpiryCheckAt: string;
  opportunities: ScrapedOpportunity[];
  perSourceCounts?: Record<string, number>;
}

function ensureDir() {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
}

export function isExpired(deadline: string): boolean {
  if (!deadline || typeof deadline !== "string") return false;
  const lower = deadline.toLowerCase();
  // Rolling / TBD / check official site => never expires
  if (lower.includes("rolling") || lower.includes("check official") || lower.includes("tbd") || lower.includes("open until")) return false;
  // Try to parse date
  const d = new Date(deadline);
  if (isNaN(d.getTime())) {
    // Try to extract YYYY-MM-DD
    const m = deadline.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const parsed = new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59`);
      if (!isNaN(parsed.getTime())) return parsed.getTime() < Date.now();
    }
    return false;
  }
  // Expired if end of that day is < now
  const endOfDay = new Date(d);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime() < Date.now();
}

export function filterExpired(opps: ScrapedOpportunity[]): { kept: ScrapedOpportunity[]; removed: number } {
  const kept: ScrapedOpportunity[] = [];
  let removed = 0;
  for (const o of opps) {
    if (isExpired(o.deadline)) removed++;
    else kept.push(o);
  }
  return { kept, removed };
}

export function readStore(): StoredData | null {
  try {
    if (!existsSync(STORAGE_FILE)) return null;
    const raw = readFileSync(STORAGE_FILE, "utf-8");
    if (!raw.trim()) return null;
    const data = JSON.parse(raw) as StoredData;
    if (!Array.isArray(data.opportunities)) return null;
    return data;
  } catch (e) {
    console.warn("[scrapedStore] read failed:", (e as Error).message);
    return null;
  }
}

export function writeStore(opportunities: ScrapedOpportunity[], perSourceCounts?: Record<string, number>) {
  ensureDir();
  // Cap at 400, dedup by applyLink + title
  const seen = new Set<string>();
  const deduped: ScrapedOpportunity[] = [];
  for (const o of opportunities) {
    const key = (o.applyLink || o.sourceUrl || o.title).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(o);
    if (deduped.length >= MAX_STORED) break;
  }
  const payload: StoredData = {
    generatedAt: new Date().toISOString(),
    lastScrapeAt: new Date().toISOString(),
    lastExpiryCheckAt: new Date().toISOString(),
    opportunities: deduped,
    perSourceCounts,
  };
  writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
}

export function mergeAndPersist(newOpps: ScrapedOpportunity[], perSourceCounts?: Record<string, number>): StoredData {
  ensureDir();
  const existing = readStore();
  const existingOpps: ScrapedOpportunity[] = existing?.opportunities || [];
  // Merge: newOpps first (fresher), then existing not duplicated
  const seen = new Set<string>();
  const merged: ScrapedOpportunity[] = [];
  for (const o of [...newOpps, ...existingOpps]) {
    const key = (o.applyLink || o.sourceUrl || o.title).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(o);
  }
  // Filter expired before persisting
  const { kept } = filterExpired(merged);
  // Cap at 400
  const capped = kept.slice(0, MAX_STORED);
  const payload: StoredData = {
    generatedAt: new Date().toISOString(),
    lastScrapeAt: new Date().toISOString(),
    lastExpiryCheckAt: existing?.lastExpiryCheckAt || new Date().toISOString(),
    opportunities: capped,
    perSourceCounts: perSourceCounts || existing?.perSourceCounts,
  };
  writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
}

export function pruneExpiredAndPersist(): { removed: number; remaining: number } {
  const existing = readStore();
  if (!existing) return { removed: 0, remaining: 0 };
  const { kept, removed } = filterExpired(existing.opportunities);
  if (removed === 0) {
    // Still update lastExpiryCheckAt
    existing.lastExpiryCheckAt = new Date().toISOString();
    writeFileSync(STORAGE_FILE, JSON.stringify(existing, null, 2), "utf-8");
    return { removed: 0, remaining: kept.length };
  }
  const payload: StoredData = {
    ...existing,
    opportunities: kept.slice(0, MAX_STORED),
    lastExpiryCheckAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`[scrapedStore] pruned ${removed} expired, ${kept.length} remain`);
  return { removed, remaining: kept.length };
}

export function getStoragePath() {
  return STORAGE_FILE;
}
