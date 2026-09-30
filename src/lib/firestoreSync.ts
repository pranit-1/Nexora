import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  writeBatch,
  DocumentData,
} from "firebase/firestore";
import type { ScrapedOpportunity } from "@/lib/ingestion/scrapers/types";

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
    const slug = cleanUrl
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
    if (slug.length >= 6) return `opp-${slug}`;
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

  return `opp-${cleanOrg}-${cleanTitle}`;
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
  errors: string[];
}

/**
 * Persists opportunities directly to the Firestore "org_opportunities" collection.
 * - Deduplication: Uses deterministic Doc ID so repeated runs UPDATE existing docs rather than duplicate.
 * - Auto-Pruning: Skips items whose deadline has passed and prunes existing expired items from Firestore.
 */
export async function syncOpportunitiesToFirestore(
  opportunities: (ScrapedOpportunity | any)[]
): Promise<SyncResult> {
  const errors: string[] = [];
  let newOrUpdated = 0;
  let skippedExpired = 0;

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
      status: "approved", // auto-approved for live explore feed
      postedByUid: "automated-ingestion",
      updatedAt: new Date().toISOString(),
      incomeLimit: inferredIncomeLimit,
      degreeLevel: inferredDegreeLevel,
    };

    validOpps.push({ id: docId, data: payload });
  }

  // 2. Batch write to Firestore in chunks of 250 (Firestore limit is 500)
  const CHUNK_SIZE = 250;
  for (let i = 0; i < validOpps.length; i += CHUNK_SIZE) {
    const chunk = validOpps.slice(i, i + CHUNK_SIZE);
    try {
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, "org_opportunities", item.id);
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
          const ref = doc(db, "org_opportunities", item.id);
          await setDoc(ref, item.data, { merge: true });
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
    const q = query(
      collection(db, "org_opportunities"),
      where("status", "==", "approved")
    );
    const snap = await getDocs(q);

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
      const batch = writeBatch(db);
      for (const docId of chunk) {
        batch.delete(doc(db, "org_opportunities", docId));
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
  const q = query(
    collection(db, "org_opportunities"),
    where("status", "==", "approved")
  );
  const snap = await getDocs(q);
  const out: DocumentData[] = [];
  snap.forEach((d) => {
    const data = d.data();
    if (!isExpired(data.deadline)) {
      out.push({ id: d.id, ...data });
    }
  });
  return out;
}
