// Persistent store for AI-generated opportunity summaries.
// Keyed by normalized source URL so repeat clicks are instant
// and summaries survive restarts without re-scraping / re-asking AI.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const STORAGE_DIR = join(process.cwd(), "storage");
const SUMMARIES_PATH = join(STORAGE_DIR, "scraped-summaries.json");
const SUMMARIES_TMP = `${SUMMARIES_PATH}.tmp`;

// Re-summarize after this many days (freshness).
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Hard ceiling on retained entries.
const MAX_ENTRIES = 500;

interface SummaryEntry {
  url: string;
  normalizedUrl: string;
  summary: string;
  provider: string;
  title: string;
  orgName: string;
  createdAt: string;
}

/**
 * Process-local mirror of the store, plus a `Map` index for O(1) lookups.
 *
 * Every accessor used to `readFileSync` + `JSON.parse` the whole file. The batch
 * summarizer calls `getCachedSummary` once per stored opportunity to decide what
 * to process and again to count the results, so a store of N opportunities in a
 * file of M summaries cost O(N*M) of synchronous disk reads and JSON parses on
 * every single batch run. The file is small and only this module writes it, so
 * holding it in memory is safe; the memo is rebuilt lazily per process.
 */
let memo: { byKey: Map<string, SummaryEntry>; order: SummaryEntry[] } | null = null;

/**
 * Saves are serialized through this chain.
 *
 * `saveSummary` is a read-modify-write against a shared file. The batch
 * summarizer runs three workers concurrently, so without a queue two workers
 * could read the same base array and the second write would silently drop the
 * first one's entry.
 */
let writeQueue: Promise<void> = Promise.resolve();

function quarantineCorruptFile(err: unknown) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${SUMMARIES_PATH}.corrupt-${stamp}`;
  try {
    renameSync(SUMMARIES_PATH, backup);
    console.error(
      `[summaries-store] ${SUMMARIES_PATH} is unreadable (${(err as Error)?.message}). ` +
        `Moved aside to ${backup} rather than overwriting it — check that file before deleting.`
    );
  } catch (renameErr) {
    console.error("[summaries-store] could not quarantine corrupt file:", (renameErr as Error)?.message);
  }
}

function loadFromDisk(): { byKey: Map<string, SummaryEntry>; order: SummaryEntry[] } {
  const byKey = new Map<string, SummaryEntry>();
  const order: SummaryEntry[] = [];

  if (!existsSync(SUMMARIES_PATH)) return { byKey, order };

  let raw: string;
  try {
    raw = readFileSync(SUMMARIES_PATH, "utf-8");
  } catch (err) {
    console.warn("[summaries-store] read failed:", (err as Error)?.message);
    return { byKey, order };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    // Previously this returned [] and the next save overwrote the file, which
    // silently destroyed the whole cache and forced every summary to be re-bought
    // with a paid AI call. Keep the damaged file for inspection instead.
    quarantineCorruptFile(err);
    return { byKey, order };
  }

  const list = Array.isArray(data) ? data : (data as { summaries?: SummaryEntry[] })?.summaries;
  if (!Array.isArray(list)) return { byKey, order };

  for (const entry of list) {
    if (!entry || typeof entry.normalizedUrl !== "string") continue;
    if (byKey.has(entry.normalizedUrl)) continue;
    byKey.set(entry.normalizedUrl, entry);
    order.push(entry);
  }
  return { byKey, order };
}

function ensureLoaded() {
  if (!memo) memo = loadFromDisk();
  return memo;
}

/**
 * Write via temp file + rename.
 *
 * `renameSync` within a directory is atomic, so a reader (or a crash) can only
 * ever observe the complete previous file or the complete new one. Writing
 * straight to the target left a truncated, unparseable file if the process was
 * frozen or killed mid-write, which the reader above would treat as an empty
 * cache.
 */
function writeAll(entries: SummaryEntry[]) {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
  const payload = JSON.stringify({ summaries: entries }, null, 2);
  try {
    writeFileSync(SUMMARIES_TMP, payload, "utf-8");
    renameSync(SUMMARIES_TMP, SUMMARIES_PATH);
  } catch (err: any) {
    console.warn("[summaries-store] write failed:", err.message);
    try {
      if (existsSync(SUMMARIES_TMP)) unlinkSync(SUMMARIES_TMP);
    } catch {
      // best effort
    }
  }
}

export function normalizeSummaryKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Returns a fresh cached summary for the url, or null. */
export function getCachedSummary(url: string): SummaryEntry | null {
  const key = normalizeSummaryKey(url);
  const found = ensureLoaded().byKey.get(key);
  if (!found) return null;
  const createdAt = new Date(found.createdAt).getTime();
  // An unparseable timestamp means we cannot prove freshness, so treat the entry
  // as stale rather than serving it forever.
  if (Number.isNaN(createdAt) || Date.now() - createdAt > MAX_AGE_MS) return null;
  return found;
}

/** Saves/updates the cached summary for a url. */
export function saveSummary(url: string, entry: { summary: string; provider: string; title: string; orgName: string }) {
  const normalizedUrl = normalizeSummaryKey(url);
  const record: SummaryEntry = {
    url,
    normalizedUrl,
    summary: entry.summary,
    provider: entry.provider,
    title: entry.title,
    orgName: entry.orgName,
    createdAt: new Date().toISOString(),
  };

  writeQueue = writeQueue.then(() => {
    const state = ensureLoaded();
    const previous = state.byKey.get(normalizedUrl);
    if (previous) {
      const at = state.order.indexOf(previous);
      if (at !== -1) state.order.splice(at, 1);
    }
    state.byKey.set(normalizedUrl, record);
    state.order.unshift(record);

    // keep bounded — trim the memo and the file from the same source of truth
    if (state.order.length > MAX_ENTRIES) {
      state.order.length = MAX_ENTRIES;
      const live = new Set(state.order.map((e) => e.normalizedUrl));
      for (const key of [...state.byKey.keys()]) {
        if (!live.has(key)) state.byKey.delete(key);
      }
    }

    writeAll(state.order);
  });

  return writeQueue;
}

export function getSummaryCount(): number {
  return ensureLoaded().order.length;
}

/** Resolves once every queued write has hit disk. */
export function flushSummaryWrites(): Promise<void> {
  return writeQueue;
}