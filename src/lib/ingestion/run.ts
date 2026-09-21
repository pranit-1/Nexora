import { getAdminDb } from "@/lib/firebaseAdmin";
import { fetchTrustedSources, fetchScrapedSources, RawListing } from "./sources";
import { normalizeToOpportunities } from "./normalize";
import { isDuplicate } from "./dedupe";
import { runAllScrapers } from "./scrapers";
import type { ScrapedOpportunity } from "./scrapers/types";

export interface IngestionSummary {
  startedAt: string;
  finishedAt: string;
  sourcesProcessed: number;
  opportunitiesExtracted: number;
  newlyAdded: number;
  skippedDuplicates: number;
  autoApproved: number;
  pendingReview: number;
  errors: string[];
  perSourceCounts?: Record<string, number>;
}

// ── Helper: persist a single opportunity to Firestore ────────────────────
async function persistOpportunity(
  db: FirebaseFirestore.Firestore,
  opp: { title: string; orgName: string; description: string; eligibility: string; deadline: string; country: string; category: string; field: string; applyLink: string; requiredDocuments: string[] },
  meta: { sourceType: "trusted-feed" | "scraped"; sourceUrl: string; autoApprove: boolean }
): Promise<"approved" | "pending" | "duplicate"> {
  const dup = await isDuplicate(opp.title, opp.orgName).catch(() => false);
  if (dup) return "duplicate";

  const status = meta.autoApprove ? "approved" : "pending";
  await db.collection("org_opportunities").add({
    postedByUid: "automated-ingestion",
    orgName: opp.orgName,
    title: opp.title,
    description: opp.description,
    eligibility: opp.eligibility,
    deadline: opp.deadline,
    country: opp.country,
    category: opp.category,
    field: opp.field,
    applyLink: opp.applyLink,
    requiredDocuments: opp.requiredDocuments,
    status,
    applicationCount: 0,
    viewCount: 0,
    source: "automated",
    sourceType: meta.sourceType,
    sourceUrl: meta.sourceUrl,
    ingestedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  return status;
}

export async function runIngestion(): Promise<IngestionSummary> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let opportunitiesExtracted = 0;
  let newlyAdded = 0;
  let skippedDuplicates = 0;
  let autoApproved = 0;
  let pendingReview = 0;
  const perSourceCounts: Record<string, number> = {};

  // ── Phase 1: Run new platform-specific scrapers (cheerio + free APIs) ──
  // These return structured ScrapedOpportunity[] directly — no AI needed.
  let directOpps: ScrapedOpportunity[] = [];
  let scraperRawListings: RawListing[] = [];
  try {
    const scrapeResult = await runAllScrapers();
    directOpps = scrapeResult.opportunities;
    scraperRawListings = scrapeResult.rawListings;
    errors.push(...scrapeResult.errors);
    Object.assign(perSourceCounts, scrapeResult.perSourceCounts);
    console.log(`[Ingestion] New scrapers: ${directOpps.length} direct opps + ${scraperRawListings.length} raw listings`);
  } catch (err: any) {
    errors.push(`New scrapers failed: ${err.message}`);
  }

  // ── Phase 2: Legacy trusted + scraped sources (RSS / HTML → AI) ───────
  const trusted = await fetchTrustedSources().catch((err) => {
    errors.push(`Trusted sources fetch failed: ${err.message}`);
    return [] as RawListing[];
  });
  const scraped = await fetchScrapedSources().catch((err) => {
    errors.push(`Scraped sources fetch failed: ${err.message}`);
    return [] as RawListing[];
  });

  // Merge legacy + scraper raw listings for AI normalization — cap 400
  const MAX_RAW_LISTINGS_PER_RUN = 400;
  const allRawListings: RawListing[] = [...trusted, ...scraped, ...scraperRawListings].slice(0, MAX_RAW_LISTINGS_PER_RUN);
  const db = getAdminDb();

  // ── Phase 2a: Persist direct opportunities (no AI call needed) ─────────
  for (const opp of directOpps) {
    try {
      const result = await persistOpportunity(db, opp, {
        sourceType: opp.sourceType,
        sourceUrl: opp.sourceUrl,
        autoApprove: opp.autoApprove,
      });
      if (result === "duplicate") {
        skippedDuplicates++;
      } else {
        opportunitiesExtracted++;
        newlyAdded++;
        if (result === "approved") autoApproved++;
        else pendingReview++;
      }
    } catch (err: any) {
      errors.push(`Failed persisting direct opp "${opp.title}": ${err.message}`);
    }
  }

  // ── Phase 2b: AI-normalize raw listings + persist ──────────────────────
  for (const listing of allRawListings) {
    try {
      const extracted = await normalizeToOpportunities(listing.rawText, listing.sourceUrl);
      opportunitiesExtracted += extracted.length;

      for (const opp of extracted) {
        const dup = await isDuplicate(opp.title, opp.orgName).catch(() => false);
        if (dup) {
          skippedDuplicates++;
          continue;
        }

        const status = listing.autoApprove ? "approved" : "pending";
        if (status === "approved") autoApproved++;
        else pendingReview++;

        await db.collection("org_opportunities").add({
          postedByUid: "automated-ingestion",
          orgName: opp.orgName,
          title: opp.title,
          description: opp.description,
          eligibility: opp.eligibility,
          deadline: opp.deadline,
          country: opp.country,
          category: opp.category,
          field: opp.field,
          applyLink: opp.applyLink,
          requiredDocuments: opp.requiredDocuments,
          status,
          applicationCount: 0,
          viewCount: 0,
          source: "automated",
          sourceType: listing.sourceType,
          sourceUrl: listing.sourceUrl,
          ingestedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
        newlyAdded++;
      }
    } catch (err: any) {
      errors.push(`Failed processing ${listing.sourceUrl}: ${err.message}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const summary: IngestionSummary = {
    startedAt,
    finishedAt,
    sourcesProcessed: directOpps.length + allRawListings.length,
    opportunitiesExtracted,
    newlyAdded,
    skippedDuplicates,
    autoApproved,
    pendingReview,
    errors,
    perSourceCounts,
  };

  try {
    await db.collection("ingestion_logs").add(summary);
  } catch (err) {
    console.error("[Ingestion] Failed to write ingestion log:", err);
  }

  return summary;
}

/** Lightweight scrape without DB writes — for testing / preview */
export async function previewScrape() {
  const { opportunities, rawListings, errors, perSourceCounts } = await runAllScrapers();
  return { opportunities, rawListings, errors, perSourceCounts };
}

/** Scrape + persist directly to Firestore org_opportunities (deterministic deduplication, expiry handled) */
export async function scrapeAndPersistToStorage() {
  const { syncOpportunitiesToFirestore } = await import("@/lib/firestoreSync");
  const result = await runAllScrapers();
  const syncResult = await syncOpportunitiesToFirestore(result.opportunities);
  return { ...result, storedCount: syncResult.newOrUpdated, syncResult };
}
