import { getAdminDb } from "@/lib/firebaseAdmin";
import { FieldPath } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";
import type { ScrapedOpportunity } from "@/lib/ingestion/scrapers/types";

/**
 * This module is SERVER-ONLY. It is imported by `instrumentation.ts`, the
 * ingestion runner, and the cron-protected `/api/scrape` + `/api/seed` routes.
 *
 * It previously used the anonymous *client* SDK (`@/lib/firebase`), which has no
 * credentials on the server. That forced `org_opportunities` to be declared
 * world-writable in `firestore.rules` so the sync could land at all: any visitor
 * could rewrite or delete the entire opportunity catalogue. Using the Admin SDK
 * bypasses rules entirely with a trusted service account, so the collection can
 * finally be locked down.
 */
function adminDb() {
  return getAdminDb();
}

/**
 * Checks whether a given deadline string has already passed.
 * Supports:
 * - Rolling / TBD / Ongoing strings (never expires)
 * - ISO dates (2026-09-30, 2026-10-15T00:00:00Z)
 * - Human-readable dates (Oct 15, 2026 / 15 October 2026)
 */
export function isExpired(deadline: string | null | undefined): boolean {
  if (!deadline || typeof deadline !== "string") return false;
  const lower = deadline.toLowerCase().trim();

  // Evergreen deadlines
  if (
    lower.includes("rolling") ||
    lower.includes("check official") ||
    lower.includes("tbd") ||
    lower.includes("open until") ||
    lower.includes("ongoing") ||
    lower.includes("always open")
  ) {
    return false;
  }

  // Check for standard date formats
  const parsed = new Date(deadline);
  if (isNaN(parsed.getTime())) {
    const match = deadline.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const dt = new Date(year, month, day, 23, 59, 59, 999);
      if (!isNaN(dt.getTime())) {
        return dt.getTime() < Date.now();
      }
    }
    return false;
  }

  // End of deadline day (inclusive)
  const endOfDay = new Date(parsed);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime() < Date.now();
}

/**
 * Generates a clean, deterministic Firestore Document ID based on the
 * opportunity's unique URL or title + organization.
 * This guarantees NO DUPLICATES on re-syncs.
 */
export function generateOpportunityDocId(opp: {
  title: string;
  applyLink?: string;
  sourceUrl?: string;
  orgName?: string;
}): string {
  const url = (opp.applyLink || opp.sourceUrl || "").trim().toLowerCase();
  if (url) {
    // Strip protocol and query params for a clean stable slug
    const cleanUrl = url
      .replace(/^https?:\/\//, "")
      .replace(/\?.*$/, "")
      .replace(/\/+$/, "");
    const slug = cleanUrl.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // A bare `.slice(0, 90)` used to drop the *distinguishing* tail of the URL:
    // Internshala's 4 distinct job URLs all share their first 90 characters, so
    // they collapsed to 2 ids and `batch.set({merge:true})` let the last one win
    // while the others vanished. Instead keep a readable head AND append a
    // short digest of the FULL normalized URL, so two URLs that share a prefix
    // can never produce the same id.
    if (slug.length >= 6) {
      const digest = shortHash(slug);
      const head = slug.slice(0, Math.max(20, 90 - digest.length - 1));
      return `opp-${head}-${digest}`;
    }
  }

  const cleanOrg = (opp.orgName || "org")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 25);
  const cleanTitle = (opp.title || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  // Same prefix-collision problem in the title fallback: two listings by the
  // same org with a long shared title prefix collided. Digest the raw
  // title+org pair so the id stays unique.
  const digest = shortHash(`${cleanOrg}|${(opp.title || "").trim().toLowerCase()}`);
  return `opp-${cleanOrg}-${cleanTitle}-${digest}`;
}

/**
 * Deterministic 8-char base36 digest (FNV-1a).
 *
 * Chosen over `crypto.createHash` because this module is imported by both the
 * Admin SDK path and client-side callers, and because the value only needs to
 * be stable and collision-resistant within a single collection, not
 * cryptographically secure.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in uint32 range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(0, 8);
}

/**
 * Infers income limit from opportunity description/eligibility.
 * Returns INR value (e.g., 800000 for 8 LPA) or undefined if not detectable.
 */
function inferIncomeLimit(opp: any): number | undefined {
  const text = `${opp.description || ""} ${opp.eligibility || ""} ${opp.title || ""}`.toLowerCase();
  // Match patterns like "8 LPA", "8 lakh", "800000", "12 lpa", "income below 8 lakh"
  const patterns = [
    /(?:income|family income|annual income|income limit|below|upto|up to)\D*(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lakhs?)/gi,
    /(?:income|family income|annual income|income limit|below|upto|up to)\D*(\d+(?:\.\d+)?)\s*(?:crore|crores?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lakhs?)\s*(?:income|family|annual|limit)/gi,
    /(?:rs\.?|inr|₹)\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi,
  ];
  for (const re of patterns) {
    const matches = [...text.matchAll(re)];
    for (const m of matches) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(val) && val > 0) {
        // Convert to INR
        if (m[0].includes("crore")) return val * 10000000;
        if (m[0].includes("lakh") || m[0].includes("lpa")) return val * 100000;
        // If just a number with ₹/INR/RS, assume it's already in INR
        if (m[0].includes("rs") || m[0].includes("₹") || m[0].includes("inr")) return val;
        // If bare number, check scale
        if (val < 100) return val * 100000; // likely in lakhs
        return val;
      }
    }
  }
  return undefined;
}

/**
 * Infers degree level from eligibility/description.
 * Returns string like "bachelor", "master", "phd", "diploma", etc.
 */
function inferDegreeLevel(opp: any): string | undefined {
  const text = `${opp.eligibility || ""} ${opp.description || ""} ${opp.title || ""}`.toLowerCase();
  const degreeMap: [RegExp, string][] = [
    [/\b(phd|ph\.d|doctorate|doctoral)\b/, "phd"],
    [/\b(master|m\.?tech|m\.?e|m\.?sc|msc|mba|m\.?c\.?a|mca|postgraduate|pg)\b/, "master"],
    [/\b(bachelor|b\.?tech|b\.?e|b\.?sc|bsc|b\.?c\.?a|bca|b\.?b\.?a|bba|undergraduate|ug)\b/, "bachelor"],
    [/\b(diploma|polytechnic|certificate|course)\b/, "diploma"],
    [/\b(12th|class\s*12|hsc|intermediate|puc)\b/, "12th"],
    [/\b(10th|class\s*10|ssc|matric)\b/, "10th"],
  ];
  for (const [re, level] of degreeMap) {
    if (re.test(text)) return level;
  }
  return undefined;
}

export interface SyncResult {
  totalProcessed: number;
  newOrUpdated: number;
  skippedExpired: number;
  prunedExpired: number;
  created: number;
  preservedAdminStatus: number;
  errors: string[];
}

/**
 * Statuses that already exist on a document and must survive a re-sync.
 *
 * `pending`/`rejected` protect the admin from being overruled (the old bug:
 * every cron reset a pulled listing back to `approved`); `approved` protects
 * the admin from the opposite direction — an `autoApprove:false` source used
 * to demote an approved document back to `pending` on content change, silently
 * revoking the approval. Once a doc has a status, only the admin panel may
 * change it.
 */
const HUMAN_DECIDED_STATUSES = new Set(["pending", "rejected", "approved"]);

/**
 * Reads the current `status` of the given document IDs.
 *
 * Needed because `batch.set({merge:true})` writes `status` unconditionally, so
 * every cron re-sync used to reset an admin's `pending`/`rejected` decision back
 * to `approved` and quietly republish listings a human had pulled.
 *
 * Firestore caps an `in` query at 30 values, so callers chunk at 30.
 */
async function loadExistingStatuses(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const snap = await adminDb()
      .collection("org_opportunities")
      .where(FieldPath.documentId(), "in", chunk)
      .select("status")
      .get();
    snap.forEach((d) => {
      const s = d.get("status");
      if (typeof s === "string") out.set(d.id, s);
    });
  }
  return out;
}

/**
 * Persists opportunities directly to the Firestore "org_opportunities" collection.
 * - Deduplication: Uses deterministic Doc ID so repeated runs UPDATE existing docs rather than duplicate.
 * - Auto-Pruning: Skips items whose deadline has passed and prunes existing expired items from Firestore.
 * - Status safety: an admin's `pending`/`rejected` decision survives re-syncs.
 */
export async function syncOpportunitiesToFirestore(
  opportunities: (ScrapedOpportunity | any)[]
): Promise<SyncResult> {
  const errors: string[] = [];
  let newOrUpdated = 0;
  let skippedExpired = 0;
  let created = 0;
  let preservedAdminStatus = 0;

  const validOpps: Array<{ id: string; data: any }> = [];

  for (const opp of opportunities) {
    // 1. Check if deadline has passed
    if (isExpired(opp.deadline)) {
      skippedExpired++;
      continue;
    }

    const docId = opp.id || generateOpportunityDocId(opp);
    // Infer income limit from description/eligibility if not provided
    const inferredIncomeLimit = inferIncomeLimit(opp);
    // Infer degree level from eligibility/description
    const inferredDegreeLevel = inferDegreeLevel(opp);

    // `autoApprove === false` is the scraper's explicit "send to moderation"
    // signal. Anything else keeps the historical behaviour of publishing straight
    // to the live explore feed, so switching a source to `autoApprove: false` is
    // now the single lever for moderating it.
    const initialStatus = opp.autoApprove === false ? "pending" : "approved";

    const payload = {
      title: opp.title || "Untitled Opportunity",
      orgName: opp.orgName || opp.organization || "NEXORA Partner",
      organization: opp.organization || opp.orgName || "NEXORA Partner",
      description: opp.description || "",
      eligibility: opp.eligibility || "Open to all students — check official guidelines.",
      deadline: opp.deadline || "Rolling — check official site",
      country: opp.country || "Global",
      category: opp.category || "Hackathons",
      field: opp.field || "Computer Science",
      applyLink: opp.applyLink || opp.sourceUrl || "#",
      requiredDocuments: opp.requiredDocuments || ["Resume"],
      sourceUrl: opp.sourceUrl || opp.applyLink || "",
      source: "automated",
      sourceType: opp.sourceType || "trusted-feed",
      scraperName: opp.scraperName || "NEXORA Ingestion",
      status: initialStatus,
      postedByUid: "automated-ingestion",
      updatedAt: new Date().toISOString(),
      incomeLimit: inferredIncomeLimit,
      degreeLevel: inferredDegreeLevel,
    };

    validOpps.push({ id: docId, data: payload });
  }

  // Look up what already exists so we never clobber a human moderation decision.
  let existing = new Map<string, string>();
  try {
    existing = await loadExistingStatuses(validOpps.map((o) => o.id));
  } catch (err: any) {
    // Fail CLOSED: writing blind would resurrect every admin-rejected listing.
    errors.push(`Status lookup failed, sync aborted to avoid overwriting admin decisions: ${err.message}`);
    return {
      totalProcessed: opportunities.length,
      newOrUpdated: 0,
      skippedExpired,
      prunedExpired: 0,
      created: 0,
      preservedAdminStatus: 0,
      errors,
    };
  }

  for (const item of validOpps) {
    const prior = existing.get(item.id);
    if (prior === undefined) {
      created++;
      continue;
    }
    if (prior !== item.data.status && HUMAN_DECIDED_STATUSES.has(prior)) {
      delete item.data.status;
      preservedAdminStatus++;
    }
  }

  // 2. Batch write to Firestore in chunks of 250 (Firestore limit is 500)
  const CHUNK_SIZE = 250;
  for (let i = 0; i < validOpps.length; i += CHUNK_SIZE) {
    const chunk = validOpps.slice(i, i + CHUNK_SIZE);
    try {
      const batch = adminDb().batch();
      for (const item of chunk) {
        const ref = adminDb().collection("org_opportunities").doc(item.id);
        batch.set(
          ref,
          {
            ...item.data,
            createdAt: item.data.createdAt || new Date().toISOString(),
          },
          { merge: true }
        );
      }
      await batch.commit();
      newOrUpdated += chunk.length;
    } catch (err: any) {
      console.error("[firestoreSync] Batch commit error, falling back to individual docs:", err.message);
      // Fallback: write doc by doc
      for (const item of chunk) {
        try {
          const ref = adminDb().collection("org_opportunities").doc(item.id);
          await ref.set(item.data, { merge: true });
          newOrUpdated++;
        } catch (e: any) {
          errors.push(`Failed doc ${item.id}: ${e.message}`);
        }
      }
    }
  }

  // 3. Auto-prune any past-deadline entries from Firestore
  let prunedExpired = 0;
  try {
    const pruneRes = await pruneExpiredFromFirestore();
    prunedExpired = pruneRes.prunedCount;
  } catch (pruneErr: any) {
    errors.push(`Pruning failed: ${pruneErr.message}`);
  }

  return {
    totalProcessed: opportunities.length,
    newOrUpdated,
    skippedExpired,
    prunedExpired,
    created,
    preservedAdminStatus,
    errors,
  };
}

/**
 * Scans Firestore "org_opportunities" collection and deletes any
 * opportunities whose deadline has expired.
 */
export async function pruneExpiredFromFirestore(): Promise<{ prunedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let prunedCount = 0;

  try {
    const oppQuery = adminDb()
      .collection("org_opportunities")
      .where("status", "==", "approved");
    const snap = await oppQuery.get();

    const expiredDocIds: string[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (isExpired(data.deadline)) {
        expiredDocIds.push(d.id);
      }
    });

    if (expiredDocIds.length === 0) {
      return { prunedCount: 0, errors: [] };
    }

    // Delete in batches of 250
    const CHUNK_SIZE = 250;
    for (let i = 0; i < expiredDocIds.length; i += CHUNK_SIZE) {
      const chunk = expiredDocIds.slice(i, i + CHUNK_SIZE);
      const batch = adminDb().batch();
      for (const docId of chunk) {
        batch.delete(adminDb().collection("org_opportunities").doc(docId));
      }
      await batch.commit();
      prunedCount += chunk.length;
    }

    console.log(`[firestoreSync] Pruned ${prunedCount} expired opportunities from Firestore.`);
  } catch (err: any) {
    console.warn("[firestoreSync] Prune error:", err.message);
    errors.push(err.message);
  }

  return { prunedCount, errors };
}

/**
 * Reads all active, approved opportunities directly from Firestore.
 */
export async function getActiveOpportunitiesFromFirestore(): Promise<DocumentData[]> {
  const q = adminDb()
    .collection("org_opportunities")
    .where("status", "==", "approved");
  const snap = await q.get();
  const out: DocumentData[] = [];
  snap.forEach((d) => {
    const data = d.data();
    if (!isExpired(data.deadline)) {
      out.push({ id: d.id, ...data });
    }
  });
  return out;
}
