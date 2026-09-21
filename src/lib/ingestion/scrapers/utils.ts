// ─── Shared scraper utilities ──────────────────────────────────────────
import * as cheerio from "cheerio";

const BOT_UA =
  "NexoraOpportunityBot/1.0 (+https://nexora.vercel.app; contact: support@nexora.app)";
const FETCH_TIMEOUT_MS = 12000;

/** Decode bytes using charset from content-type; fallback latin1 if UTF-8 looks broken */
function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  const charset = (contentType || "").match(/charset=([\w-]+)/i)?.[1];
  if (charset && !/utf-?8/i.test(charset)) {
    try {
      const text = new TextDecoder(charset).decode(buf);
      if (!text.includes("\uFFFD")) return text;
    } catch {}
  }
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8;
  // Broken UTF-8 (mojibake like "A��,��??") → the page is likely latin-1/windows-1252
  try {
    const latin = new TextDecoder("latin1").decode(buf);
    if (!latin.includes("\uFFFD")) return latin;
  } catch {}
  return utf8;
}

/** Fetch with timeout + bot UA + retry once + correct charset decoding */
export async function fetchText(url: string, retries = 1): Promise<string> {
  const attempt = async (): Promise<string> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BOT_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: ctrl.signal,
        next: { revalidate: 0 } as any,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = await res.arrayBuffer();
      return decodeBody(buf, res.headers.get("content-type"));
    } finally {
      clearTimeout(t);
    }
  };

  try {
    return await attempt();
  } catch (e: any) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 800));
      return attempt();
    }
    throw e;
  }
}

export async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BOT_UA, Accept: "application/json" },
      signal: ctrl.signal,
      next: { revalidate: 0 } as any,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function loadCheerio(html: string) {
  return cheerio.load(html);
}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function decodeEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'");
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Try to parse an ISO deadline from any date-like string */
export function parseDeadline(raw?: string): string {
  if (!raw) return "Rolling — check official site";
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2024 && d.getFullYear() <= 2030) {
    return d.toISOString().split("T")[0];
  }
  // try DD-MM-YYYY / DD/MM/YYYY
  const m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    const d2 = new Date(`${yyyy}-${mm}-${dd}`);
    if (!isNaN(d2.getTime())) return d2.toISOString().split("T")[0];
  }
  const trimmed = raw.trim();
  if (trimmed.length > 3 && trimmed.length < 60) return trimmed;
  return "Rolling — check official site";
}
