import { NextResponse } from "next/server";
import { runAllScrapers } from "@/lib/ingestion/scrapers";
import {
  syncOpportunitiesToFirestore,
  getActiveOpportunitiesFromFirestore,
  pruneExpiredFromFirestore,
} from "@/lib/firestoreSync";
import { requireCron } from "@/lib/serverAuth";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/scrape?preview=1  -> PUBLIC, read-only. Serve the active dataset from Firestore.
// GET /api/scrape?force=1    -> CRON ONLY. Run scrapers, upsert deduplicated, prune expired.
// GET /api/scrape?source=x   -> CRON ONLY. Scrape a single source and upsert it.
// Any combination of preview + source/force is rejected: `preview` must never grant a write.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const preview = url.searchParams.get("preview") === "1";
  const force = url.searchParams.get("force") === "1";
  const source = url.searchParams.get("source");

  const wantsWrite = Boolean(force || source);
  if (preview && wantsWrite) {
    return NextResponse.json(
      { error: "preview=1 is read-only and cannot be combined with force=1 or source=" },
      { status: 400 }
    );
  }

  const limited = enforceRateLimit(request, LIMITS.scrapePreview);
  if (!limited.ok) return limited.response;

  // `requireCron` fails closed in production when CRON_SECRET is missing/blank.
  // The default branch (no preview flag) can also trigger the scrapers, so it is gated too.
  if (wantsWrite || !preview) {
    const auth = await requireCron(request);
    if (!auth.ok) return auth.response;
  }

  try {
    // Single-source test/preview
    if (source) {
      const map: Record<string, () => Promise<any>> = {
        devpost: async () => (await import("@/lib/ingestion/scrapers/devpost")).scrapeDevpost(),
        unstop: async () => (await import("@/lib/ingestion/scrapers/unstop")).scrapeUnstop(),
        internshala: async () => (await import("@/lib/ingestion/scrapers/internshala")).scrapeInternshala(),
        jobs: async () => (await import("@/lib/ingestion/scrapers/jobsApi")).scrapeJobsApis(),
        scholarships: async () => {
          const m = await import("@/lib/ingestion/scrapers/scholarships");
          const [a, b] = await Promise.all([m.scrapeScholarshipRss(), m.scrapeScholarshipHtml()]);
          return [...a, ...b];
        },
        conferences: async () => (await import("@/lib/ingestion/scrapers/conferences")).scrapeConferences(),
        fellowships: async () => (await import("@/lib/ingestion/scrapers/fellowships")).scrapeFellowships(),
        generic: async () => (await import("@/lib/ingestion/scrapers/generic")).scrapeGenericPages(),
      };
      const key = source.toLowerCase();
      // Object.hasOwn, not `map[key]` — otherwise ?source=constructor resolves to Object.
      if (!Object.hasOwn(map, key)) {
        return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
      }
      const scraped = await map[key]();

      // Upsert these directly to Firestore so they persist without duplicates
      const syncResult = await syncOpportunitiesToFirestore(scraped);
      return NextResponse.json({
        success: true,
        source,
        count: scraped.length,
        syncResult,
        opportunities: scraped,
      });
    }

    const t0 = Date.now();

    // 1. Check current Firestore contents first
    const existing = await getActiveOpportunitiesFromFirestore();

    // If we have active opportunities in Firestore and force is not requested:
    // prune expired and return the active data. The prune is awaited — a fire-and-forget
    // promise after the response is returned never completes on serverless.
    if (!force && existing.length > 0) {
      try {
        const prune = await pruneExpiredFromFirestore();
        if (prune.prunedCount > 0) {
          console.log(`[api/scrape] pruned ${prune.prunedCount} expired opportunities`);
        }
      } catch (err: any) {
        console.warn("[api/scrape] prune error:", err.message);
      }

      return NextResponse.json({
        success: true,
        source: "firestore",
        cached: true,
        count: existing.length,
        durationMs: Date.now() - t0,
        opportunities: existing,
      });
    }

    // 2. Otherwise (or if force=1 / Firestore empty): Run scrapers & sync to Firestore
    console.log("[api/scrape] Running scrapers to sync into Firestore...");
    const scrapeResult = await runAllScrapers();

    // Sync scraped opportunities to Firestore (No Duplicates + Auto Expiry Filter)
    const syncResult = await syncOpportunitiesToFirestore(scrapeResult.opportunities);

    // Read back final active dataset from Firestore
    const finalOpps = await getActiveOpportunitiesFromFirestore();

    return NextResponse.json({
      success: true,
      source: "live-scraped-to-firestore",
      cached: false,
      durationMs: Date.now() - t0,
      count: finalOpps.length,
      scrapedCount: scrapeResult.opportunities.length,
      syncResult,
      perSourceCounts: scrapeResult.perSourceCounts,
      errors: scrapeResult.errors,
      opportunities: finalOpps,
    });
  } catch (err: any) {
    console.error("[Scrape] Fatal:", err);
    return NextResponse.json({ error: err.message || "Scrape failed" }, { status: 500 });
  }
}
