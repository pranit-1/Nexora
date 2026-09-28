import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { AIRouterService } from "@/lib/aiProviders";
import { computePerformanceProfile, bandLabel, ENGINE_VERSION } from "@/lib/wallet/performanceProfile";
import { describeInsights } from "@/lib/wallet/documentInsights";
import { normalizeCategory } from "@/lib/wallet/categories";
import { parseProfileLink } from "@/lib/profileLinks";
import type { PerformanceProfile, PerformanceSnapshot, ProfileLink, WalletDocument } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Performance profile API.
 *
 * GET  /api/wallet/performance-profile?uid=...        → cached snapshot (computed on first call)
 * POST /api/wallet/performance-profile {uid, refresh} → recompute from the wallet, rewrite the
 *                                                     narrative with the LLM when the documents
 *                                                     changed, and mirror the score onto the user doc.
 *
 * The snapshot lives at users/{uid}/tracker/performance so the wallet documents and the profile
 * stay linked: every upload/rescan makes the profile staler, and this route notices via fingerprint.
 */

const TRACKER_PATH = (uid: string) => `users/${uid}/tracker/performance`;

function fingerprintOf(docs: WalletDocument[], links: ProfileLink[]): string {
  const docPart = docs
    .map((d) => `${d.id}:${d.category}:${d.categoryUpdatedAt || d.uploadedAt}:${d.categoryNeedsReview ? 1 : 0}`)
    .sort()
    .join("|");
  const linkPart = links
    .map((l) => `${l.id}:${l.url}`)
    .sort()
    .join("|");
  return `${docPart}#${linkPart}`;
}

/** Compact, token-cheap evidence digest handed to the model. */
function buildDigest(profile: PerformanceProfile, docs: WalletDocument[]): string {
  const lines: string[] = [];
  lines.push(`Composite score: ${profile.overall}/100 (potential ${profile.potential}/100, coverage ${profile.coverage}%, ${profile.docCount} documents).`);
  if (profile.profileLinks?.length) {
    lines.push(`Public profile links the user saved: ${profile.profileLinks.map((l) => `${l.label || l.kind} ${l.url}`).join("; ")}`);
  }
  for (const d of profile.dimensions) {
    if (d.missing) {
      lines.push(`- ${d.label}: NO EVIDENCE YET (weight ${d.weight})`);
    } else {
      lines.push(`- ${d.label}: ${d.score}/100 (weight ${d.weight}, ${d.docCount} docs) | evidence: ${d.evidence.join("; ") || "none"} | issues: ${d.notes.join("; ") || "none"}`);
    }
  }
  lines.push("Documents:");
  for (const d of docs) {
    lines.push(`* [${d.category}] ${d.name} — ${describeInsights(d.insights)}`);
  }
  lines.push(`Documents still needing category confirmation: ${profile.needsReviewCount}.`);
  return lines.join("\n");
}

/**
 * `AIRouterService.requestAI(prompt, true)` already returns a parsed object when
 * the provider honours JSON mode, but falls back to the raw text when it does
 * not. Accept either shape.
 */
function coerceJson(raw: unknown): { narrative?: string; strengths?: string[] } | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    const text = value
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      value = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return value as { narrative?: string; strengths?: string[] };
}

async function narrate(profile: PerformanceProfile, docs: WalletDocument[]): Promise<{ narrative?: string; strengths?: string[] }> {
  const prompt = `You are a strict academic and career advisor. You are given verified facts extracted from a student's own uploaded documents, plus a computed score breakdown.

${buildDigest(profile, docs)}

Write for this student:
1. "narrative": 2-4 sentences, max 90 words, written directly TO the student in the second person ("Your certificates are your strongest asset"). Never write "the student", "your file" or third-person phrasing. Cite their real numbers and real achievements from the documents above. If a document could not be read, say what is missing, not what it probably says. No invented facts, no generic encouragement, no mention that you are an AI.
2. "strengths": up to 3 short strings, each naming a proven strength with the evidence that proves it. Only list things backed by a document.

Return ONLY valid JSON: { "narrative": string, "strengths": string[] }`;
  try {
    const parsed = coerceJson(await AIRouterService.requestAI(prompt, true));
    if (!parsed) throw new Error("model did not return a JSON object");
    const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim().slice(0, 700) : undefined;
    const strengths = Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0).map((s: string) => s.trim().slice(0, 120)).slice(0, 3)
      : undefined;
    return { narrative: narrative || undefined, strengths: strengths?.length ? strengths : undefined };
  } catch (e) {
    console.warn("[performance-profile] narrative fell back to rules:", (e as Error)?.message);
    return {};
  }
}

async function loadDocs(db: ReturnType<typeof getAdminDb>, uid: string): Promise<WalletDocument[]> {
  const snap = await db.collection("wallet").where("uid", "==", uid).get();
  return snap.docs.map((d) => {
    const data = d.data() as WalletDocument;
    return { ...data, id: data.id || d.id, category: normalizeCategory(data.category) || "Other" };
  });
}

async function loadLinks(db: ReturnType<typeof getAdminDb>, uid: string): Promise<ProfileLink[]> {
  const snap = await db.collection(`users/${uid}/profileLinks`).get();
  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<ProfileLink>;
      const parsed = data.url ? parseProfileLink(data.url) : null;
      return {
        id: d.id,
        url: parsed?.ok ? parsed.url : String(data.url || ""),
        kind: data.kind || parsed?.kind || "other",
        label: (typeof data.label === "string" && data.label.trim()) || parsed?.label,
        addedAt: typeof data.addedAt === "string" ? data.addedAt : undefined,
        origin: data.origin === "document" ? "document" : "manual",
      } as ProfileLink;
    })
    .filter((l) => l.url);
}

async function build(uid: string, refreshNarrative: boolean, force: boolean) {
  const db = getAdminDb();
  const docs = await loadDocs(db, uid);
  const links = await loadLinks(db, uid);
  const profile = computePerformanceProfile(docs, links);
  const fingerprint = fingerprintOf(docs, links);

  const ref = db.doc(TRACKER_PATH(uid));
  const cached = (await ref.get()).data() as PerformanceSnapshot | undefined;
  const stale = force || !cached || cached.fingerprint !== fingerprint || cached.engineVersion !== ENGINE_VERSION;

  let finalProfile: PerformanceProfile = profile;
  // A narrative is only ever reused when it still describes the current wallet.
  // Anything that makes the profile stale (new/changed documents, a new engine
  // version) needs a fresh one, and so does an explicit refresh from the client.
  const wantsNarrative = docs.length > 0 && (force || refreshNarrative);
  if (wantsNarrative || stale) {
    if (docs.length) {
      const ai = await narrate(profile, docs);
      finalProfile = {
        ...profile,
        narrative: ai.narrative || profile.narrative,
        strengths: ai.strengths?.length ? ai.strengths : profile.strengths,
      };
    }
  } else if (cached?.narrative && docs.length) {
    finalProfile = { ...profile, narrative: cached.narrative, strengths: cached.strengths?.length ? cached.strengths : profile.strengths };
  }

  const snapshot: PerformanceSnapshot = {
    ...finalProfile,
    uid,
    fingerprint,
    engineVersion: ENGINE_VERSION,
    bandLabel: bandLabel(finalProfile.band),
  };

  const mustPersist = stale || wantsNarrative;
  if (mustPersist) {
    await ref.set(snapshot, { merge: true });
    // Mirror the headline numbers onto the user document so the profile page
    // and any other surface can read them without a second query.
    await db.doc(`users/${uid}`).set(
      {
        performanceScore: finalProfile.overall,
        performanceBand: finalProfile.band,
        performanceCoverage: finalProfile.coverage,
        performanceDocCount: finalProfile.docCount,
        performanceUpdatedAt: finalProfile.computedAt,
      },
      { merge: true }
    );
  }

  return { ...snapshot, stale, persisted: mustPersist };
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get("uid")?.trim();
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 });
  try {
    const data = await build(uid, false, false);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[performance-profile] GET", (e as Error)?.message);
    return NextResponse.json({ error: "Could not build the performance profile" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let uid = "";
  let refresh = false;
  let force = false;
  try {
    const body = (await request.json()) as { uid?: string; refreshNarrative?: boolean; force?: boolean };
    uid = (body.uid || "").trim();
    refresh = !!body.refreshNarrative;
    force = !!body.force;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 });
  try {
    const data = await build(uid, refresh, force);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[performance-profile] POST", (e as Error)?.message);
    return NextResponse.json({ error: "Could not build the performance profile" }, { status: 500 });
  }
}
