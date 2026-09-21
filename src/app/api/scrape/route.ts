import { NextResponse } from "next/server";
import { runAllScrapers } from "@/lib/ingestion/scrapers";
import {
  syncOpportunitiesToFirestore,
  getActiveOpportunitiesFromFirestore,
  pruneExpiredFromFirestore,
} from "@/lib/firestoreSync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

// GET /api/scrape?preview=1  -> serve directly from Firestore (auto-pruning expired)
// GET /api/scrape?force=1    -> run scrapers, upsert deduplicated to Firestore, prune expired
export async function GET(request: Request) {
  const url = new URL(request.url);
  const preview = url.searchParams.get("preview") === "1";
  const force = url.searchParams.get("force") === "1";
  const source = url.searchParams.get("source");

  if (!preview && !isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      const fn = map[source.toLowerCase()];
      if (!fn) return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
      const scraped = await fn();

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
    // Just run auto-prune on Firestore and return active data instantly!
    if (!force && existing.length > 0) {
      // Async prune expired in background
      pruneExpiredFromFirestore().catch((err) =>
        console.warn("[api/scrape] background prune error:", err.message)
      );

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

export async function POST(request: Request) {
  return GET(request);
}
