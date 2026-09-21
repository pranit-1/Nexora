import { NextResponse } from "next/server";
import { AIRouterService } from "@/lib/aiProviders";
import { getCachedSummary, saveSummary } from "@/lib/storage/summariesStore";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8212;|&#8211;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Charset-aware HTML decoding: honors the header charset, falls back to utf-8,
// and retries latin1 when utf-8 produces replacement chars (kills mojibake).
function decodeBody(buf: ArrayBuffer, contentType: string): string {
  const charsetMatch = contentType.match(/charset=([\w-]+)/i);
  const declared = charsetMatch ? charsetMatch[1].toLowerCase() : "";
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (declared && declared !== "utf-8" && declared !== "utf8") {
    try {
      return new TextDecoder(declared as any).decode(buf);
    } catch {
      return utf8.includes("\uFFFD") ? new TextDecoder("latin1").decode(buf) : utf8;
    }
  }
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("latin1").decode(buf);
}

// Split filtered text down to meaningful lines (no nav/ad boilerplate).
function cleanSnippets(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const line of text.split(/(?:\.|!|\?)\s+/)) {
    const t = line.trim();
    if (t.length < 25 || t.length > 220) continue;
    if (/\b(menu|login|sign in|sign up|subscribe|newsletter|cookie|privacy|terms|©|copyright)\b/i.test(t)) continue;
    if (/^[\s\d\W]+$/.test(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function buildFallback(args: {
  title: string;
  orgName: string;
  url: string;
  category: string;
  deadline: string;
  country: string;
  field: string;
  eligibility: string;
  snippets: string[];
  reason: string;
}): string {
  const { title, orgName, url, category, deadline, country, field, eligibility, snippets, reason } = args;
  const notable = snippets.slice(0, 5).map((s) => `- ${s}`).join("\n");
  const cat = category && category !== "General" ? category : "opportunity";
  const lines: string[] = [];
  lines.push(`## Quick Summary`);
  lines.push(`${title} is a ${cat}${orgName ? ` by ${orgName}` : ""}. Here is everything we could verify from the listing${country ? ` (${country})` : ""}.`);
  lines.push("");
  lines.push(`## What it's about`);
  lines.push(notable || `- ${title} — check the official page for the full program description.`);
  lines.push("");
  lines.push(`## Who can apply`);
  const el = (eligibility || "").replace(/^Check official/i, "");
  lines.push(`- ${eligibility && eligibility.trim().length > 3 ? eligibility : `Open to eligible students/professionals — full criteria on the official page.`}${el && !/official/i.test(el) ? "" : ""}`);
  lines.push("");
  lines.push(`## Important Dates & Location`);
  lines.push(`- Deadline: ${deadline || "Check official page"}`);
  lines.push(`- Location: ${country || "Check official page"}`);
  lines.push(`- Field: ${field || "General"}`);
  lines.push("");
  lines.push(`## How to Apply`);
  lines.push(`1. Open the official link below`);
  lines.push(`2. Read eligibility, deadline and required documents`);
  lines.push(`3. Complete the application form`);
  lines.push(`4. Submit before the deadline and save your confirmation`);
  lines.push("");
  lines.push(`## Main Facts`);
  lines.push(`- Title: ${title}`);
  if (orgName) lines.push(`- Organization: ${orgName}`);
  if (category) lines.push(`- Category: ${category}`);
  lines.push(`- Deadline: ${deadline || "Check official page"}`);
  if (field && field !== "General") lines.push(`- Field: ${field}`);
  lines.push(`- Apply at: ${url}`);
  lines.push("");
  lines.push(`_Auto-generated summary (AI offline: ${reason.slice(0, 90)}). Click the source link for full original details._`);
  return lines.join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url: string = body.url || body.sourceUrl || "";
    const title: string = body.title || "";
    const orgName: string = body.orgName || body.organization || "";
    const category: string = body.category || "";
    const deadline: string = body.deadline || "";
    const country: string = body.country || "";
    const field: string = body.field || "";
    const eligibility: string = body.eligibility || "";

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "Valid url required" }, { status: 400 });
    }

    // 1. Serve cache instantly (repeat clicks → no re-scrape / no AI cost)
    const cached = getCachedSummary(url);
    if (cached) {
      return NextResponse.json({
        success: true,
        url,
        title: cached.title || title,
        orgName: cached.orgName || orgName,
        summary: cached.summary,
        provider: cached.provider + "-cached",
        cached: true,
      });
    }

    // 2. Fetch full page (with charset-aware decode to avoid mojibake)
    let text = "";
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "NexoraOpportunityBot/1.0 (+https://nexora.vercel.app)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
      const buf = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "";
      text = stripHtml(decodeBody(buf, contentType));
    } catch (e: any) {
      text = "";
    }

    const raw = text.slice(0, 12000);
    const snippets = cleanSnippets(text);

    // 3. Try AI
    try {
      if (raw.length >= 60) {
        const prompt = `You are NEXORA's opportunity explainer. Summarize the opportunity page below into a proper easy-to-understand format so any student can understand what is happening.

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

If any info is not found on the page, write "Check official page" rather than guessing. Keep total under 450 words.

Context (card info): Title="${title}" Organization="${orgName}" Category="${category}" Deadline="${deadline}" Country="${country}" Field="${field}" Eligibility="${eligibility}" URL="${url}"

FULL PAGE TEXT:
"""
${raw}
"""`;

        const summary = await AIRouterService.requestAI(prompt, false);
        const summaryText = typeof summary === "string" ? summary : JSON.stringify(summary);
        if (summaryText && summaryText.trim().length > 50) {
          saveSummary(url, { summary: summaryText, provider: "openrouter-key1", title, orgName });
          return NextResponse.json({
            success: true,
            url,
            title,
            orgName,
            summary: summaryText,
            sourceLength: raw.length,
            provider: "openrouter-key1",
          });
        }
        throw new Error("Empty AI output");
      }
      throw new Error("Page content too short for AI");
    } catch (aiErr: any) {
      // 4. Smart fallback from card metadata + clean snippets (never raw dump)
      console.warn("[summarize] AI failed, using metadata fallback:", aiErr.message);
      const fallback = buildFallback({ title, orgName, url, category, deadline, country, field, eligibility, snippets, reason: aiErr.message || "offline" });
      saveSummary(url, { summary: fallback, provider: "fallback-metadata", title, orgName });
      return NextResponse.json({
        success: true,
        url,
        title,
        orgName,
        summary: fallback,
        sourceLength: raw.length,
        provider: "fallback-metadata",
        warning: aiErr.message,
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Summarize failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  return POST(new Request(request.url, { method: "POST", body: JSON.stringify({ url: target }), headers: { "Content-Type": "application/json" } } as any));
}