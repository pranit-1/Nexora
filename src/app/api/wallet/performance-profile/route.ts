import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { AIRouterService } from "@/lib/aiProviders";
import { computePerformanceProfile, bandLabel, ENGINE_VERSION } from "@/lib/wallet/performanceProfile";
import { describeInsights } from "@/lib/wallet/documentInsights";
import { normalizeCategory } from "@/lib/wallet/categories";
import { parseProfileLink } from "@/lib/profileLinks";
import { extractUsernameFromUrl, fetchUserRepos, scoreRepository, aggregateGitHubScore } from "@/lib/github";
import { fetchCodingProfile, scoreCodingProfile, aggregateCodingScore } from "@/lib/codingPlatforms";
import { requireUser } from "@/lib/serverAuth";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import type { PerformanceProfile, PerformanceSnapshot, ProfileLink, WalletDocument } from "@/lib/types";

export const dynamic = "force-dynamic";
// The outbound GitHub + coding-platform fan-out plus one LLM narrative call
// does not fit the default 60s budget for active users.
export const maxDuration = 120;

/**
 * Performance profile API.
 *
 * POST /api/wallet/performance-profile { refreshNarrative?, force? }
 *   → recompute from the caller's own wallet, rewrite the narrative with the LLM
 *     when the documents changed, and mirror the score onto the caller's user doc.
 *
 * The uid is ALWAYS taken from the verified Firebase ID token. It used to be read
 * from `?uid=` / `body.uid`, which combined with the Admin SDK (which bypasses
 * firestore.rules) let any anonymous caller read and rewrite any account's
 * profile. A mutating GET was also removed — link prefetchers and crawlers were
 * triggering paid LLM calls and Firestore writes.
 *
 * The snapshot lives at users/{uid}/tracker/performance so the wallet documents and the profile
 * stay linked: every upload/rescan makes the profile staler, and this route notices via fingerprint.
 */

const TRACKER_PATH = (uid: string) => `users/${uid}/tracker/performance`;

function fingerprintOf(docs: WalletDocument[], links: ProfileLink[], githubKey: string, codingKey: string): string {
  const docPart = docs
    .map((d) => `${d.id}:${d.category}:${d.categoryUpdatedAt || d.uploadedAt}:${d.categoryNeedsReview ? 1 : 0}`)
    .sort()
    .join("|");
  const linkPart = links
    .map((l) => `${l.id}:${l.url}`)
    .sort()
    .join("|");
  // Deliberately keyed on the *link*, not on the fetch result. A GitHub outage
  // or rate-limit must not change the fingerprint, otherwise every failed fetch
  // marks the profile stale and buys a paid LLM narrative call.
  return `${docPart}#${linkPart}#${githubKey}#${codingKey}`;
}

/** Compact, token-cheap evidence digest handed to the model. */
function buildDigest(profile: PerformanceProfile, docs: WalletDocument[]): string {
  const lines: string[] = [];
  lines.push(`Composite score: ${profile.overall}/100 (potential ${profile.potential}/100, coverage ${profile.coverage}%, ${profile.docCount} documents).`);
  if (profile.profileLinks?.length) {
    lines.push(`Public profile links the user saved: ${profile.profileLinks.map((l) => `${safeField(l.label || l.kind, 40)} ${safeField(l.url, 120)}`).join("; ")}`);
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
    lines.push(`* [${d.category}] ${safeField(d.name, 90)} — ${safeField(describeInsights(d.insights), 220)}`);
  }
  lines.push(`Documents still needing category confirmation: ${profile.needsReviewCount}.`);
  return lines.join("\n");
}

/** Greedy /\{[\s\S]*\}/ matched from the first "{" to the last "}", discarding
 *  any reply that contained two JSON objects. Scan for the first balanced one. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
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
    const match = extractFirstJsonObject(text);
    if (!match) return null;
    try {
      value = JSON.parse(match);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return value as { narrative?: string; strengths?: string[] };
}

/** Document-derived strings are attacker-controlled; strip prompt scaffolding. */
function safeField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[""`<>]|\b(?:ignore|disregard)\b[^\n]{0,40}/gi, " ").replace(/\s+/g, " ").slice(0, max);
}

interface AIEvaluationResult {
  overallScore?: number;
  studentLevel?: string;
  studentLevelDescription?: string;
  narrative?: string;
  strengths?: string[];
  gaps?: string[];
  nextSteps?: string[];
  dimensionAdjustments?: Record<string, number>;
}

function coerceEvaluationJson(raw: unknown): AIEvaluationResult | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    const text = value
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const match = extractFirstJsonObject(text);
    if (!match) return null;
    try {
      value = JSON.parse(match);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return value as AIEvaluationResult;
}

/**
 * Deep AI Student Evaluation using AI keys (Gemini / OpenRouter / Groq).
 * Examines all student wallet documents, projects, academic credentials, and external links,
 * evaluates student capability level, and scores the profile with real academic/industry benchmarks.
 */
async function evaluateStudentWithAI(
  profile: PerformanceProfile,
  docs: WalletDocument[],
  links: ProfileLink[]
): Promise<AIEvaluationResult> {
  const documentsSummary = docs.map((d) => ({
    name: safeField(d.name, 90),
    category: d.category,
    insights: d.insights,
    previewText: safeField(d.extractedText || "", 350),
  }));

  const prompt = `You are the Lead Academic & Industry Career Evaluator for NEXORA.
Your job is to deeply analyze a student's actual uploaded documents, credentials, achievements, coding profiles, and projects to determine their REAL student caliber, level, and capability rating.

Evaluation Data (verified from student's wallet):
- Total Documents Uploaded: ${docs.length}
- Public Links: ${links.map((l) => `${l.kind}: ${l.url}`).join(", ") || "None"}
- Base Dimension Signals:
${profile.dimensions.map((d) => `  * ${d.label}: ${d.missing ? "No documents" : `${d.score}/100 based on ${d.docCount} docs`}`).join("\n")}
- Document Content & Extracted Facts:
${JSON.stringify(documentsSummary, null, 2)}

Instructions:
1. Conduct a rigorous, realistic assessment based purely on the evidence above.
2. Determine:
   - "overallScore": Integer between 0 and 100 representing their true holistic industry/scholarship readiness.
   - "studentLevel": One of:
     * "Level 1: Novice / Explorer"
     * "Level 2: Emerging Talent"
     * "Level 3: Competent Practitioner"
     * "Level 4: Advanced Specialist"
     * "Level 5: Top-Tier Scholar / Elite"
   - "studentLevelDescription": 1-2 sharp sentences justifying their assigned tier based on their real proof.
   - "narrative": 3-4 sentences directly addressing the student in second person ("You"). Evaluate their real credentials, academic caliber, project depth, and industry preparedness. Be honest, rigorous, and direct.
   - "strengths": 3-4 specific verified strengths supported by their documents.
   - "gaps": 2-3 genuine gaps or missing credentials holding them back from top tier.
   - "nextSteps": 3 high-impact, actionable steps to reach the next level.
   - "dimensionAdjustments": Object containing calibrated 0-100 scores for active dimensions ("academics", "credentials", "recognition", "projects", "skills", "recency", "network", "readiness").

Return ONLY valid JSON:
{
  "overallScore": number,
  "studentLevel": string,
  "studentLevelDescription": string,
  "narrative": string,
  "strengths": string[],
  "gaps": string[],
  "nextSteps": string[],
  "dimensionAdjustments": {
    "academics"?: number,
    "credentials"?: number,
    "recognition"?: number,
    "projects"?: number,
    "skills"?: number,
    "recency"?: number,
    "network"?: number,
    "readiness"?: number
  }
}`;

  try {
    const raw = await AIRouterService.requestAI(prompt, true);
    const parsed = coerceEvaluationJson(raw);
    if (!parsed) throw new Error("Model did not return a valid evaluation JSON object");
    return parsed;
  } catch (e) {
    console.warn("[performance-profile] Deep AI evaluation failed, falling back to heuristics:", (e as Error)?.message);
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
      const data = d.data() as Partial<ProfileLink> & { addedAt?: { toDate?: () => Date; seconds?: number } };
      const parsed = data.url ? parseProfileLink(data.url) : null;
      let addedAt: string | undefined;
      if (data.addedAt && typeof data.addedAt === "object" && "toDate" in data.addedAt) {
        addedAt = (data.addedAt as { toDate: () => Date }).toDate().toISOString();
      } else if (typeof data.addedAt === "string") {
        addedAt = data.addedAt;
      } else if (data.addedAt && typeof data.addedAt === "object" && data.addedAt !== null && "seconds" in data.addedAt) {
        addedAt = new Date((data.addedAt as Record<string, unknown>).seconds as number * 1000).toISOString();
      }
      return {
        id: d.id,
        url: parsed?.ok ? parsed.url : String(data.url || ""),
        kind: data.kind || parsed?.kind || "other",
        label: (typeof data.label === "string" && data.label.trim()) || parsed?.label,
        addedAt,
        origin: data.origin === "document" ? "document" : "manual",
      } as ProfileLink;
    })
    .filter((l) => l.url);
}

async function build(uid: string, refreshNarrative: boolean, force: boolean) {
  const db = getAdminDb();
  const docs = await loadDocs(db, uid);
  const links = await loadLinks(db, uid);

  // Extract GitHub username from profile links
  const githubLink = links.find((l) => l.kind === "github");
  const githubUsername = githubLink ? extractUsernameFromUrl(githubLink.url) : null;

  // Extract coding platform URLs
  // Check both kind and URL for platform detection
  const codingLinks = links.filter((l) => {
    const isCodingPlatform = ["leetcode", "codechef", "codeforces", "geeksforgeeks", "hackerrank", "atcoder"].includes(l.kind);
    const url = (l.url || "").toLowerCase();
    const isCodingUrl = url.includes("leetcode.com") || url.includes("codechef.com") || url.includes("codeforces.com") || url.includes("geeksforgeeks.org") || url.includes("hackerrank.com") || url.includes("atcoder.jp");
    return isCodingPlatform || isCodingUrl;
  });
  // Deduped: saving the same LeetCode URL twice used to fire two parallel
  // GraphQL calls and double-weight that platform in the aggregate.
  const codingTargets = Array.from(new Map(codingLinks.map((l) => [l.url.toLowerCase(), l])).values());
  const codingKey = `coding:${codingTargets.map((l) => l.kind).sort().join(",")}`;

  // Fetch GitHub data
  let githubData: any = null;
  if (githubUsername) {
    console.log("[performance-profile] Fetching GitHub repos for:", githubUsername);
    try {
      const repos = await fetchUserRepos(githubUsername);
      console.log("[performance-profile] Got", repos.length, "repos for", githubUsername);
      const scored = repos.map(scoreRepository);
      githubData = aggregateGitHubScore(scored);
      console.log("[performance-profile] GitHub aggregate score:", githubData.total);
      // Add score property for scoreGitHub function
      githubData.score = githubData.total;
    } catch (e) {
      console.warn("[performance-profile] GitHub fetch failed:", (e as Error)?.message);
    }
  } else {
    console.log("[performance-profile] No GitHub username found in links");
  }

  // Fetch coding platform data
  let codingData: any = null;
  if (codingTargets.length) {
    console.log("[performance-profile] Fetching coding profiles for:", codingTargets.map((l) => l.kind));
    try {
      const profiles = await Promise.all(codingTargets.map((l) => fetchCodingProfile(l.url)));
      console.log("[performance-profile] Got coding profiles:", profiles.map((p) => ({ platform: p?.platform, username: p?.username, rating: p?.rating, problemsSolved: p?.problemsSolved, contestCount: p?.contestCount })));
      const scored = profiles.filter(Boolean).map((p) => scoreCodingProfile(p!));
      codingData = aggregateCodingScore(scored);
      console.log("[performance-profile] Coding aggregate score:", codingData.total);
      // Add score property for scoreCodingPlatforms function
      codingData.score = codingData.total;
    } catch (e) {
      console.warn("[performance-profile] Coding platform fetch failed:", (e as Error)?.message);
    }
  } else {
    console.log("[performance-profile] No coding platform links found");
  }

  const profile = computePerformanceProfile(docs, links, githubData, codingData);
  const fingerprint = fingerprintOf(docs, links, `gh:${githubUsername || ""}`, codingKey);

  const ref = db.doc(TRACKER_PATH(uid));
  const cached = (await ref.get()).data() as PerformanceSnapshot | undefined;
  const stale = force || !cached || cached.fingerprint !== fingerprint || cached.engineVersion !== ENGINE_VERSION;

  let finalProfile: PerformanceProfile = profile;
  const wantsNarrative = docs.length > 0 && (force || refreshNarrative);
  if (wantsNarrative || stale) {
    if (docs.length) {
      const ai = await evaluateStudentWithAI(profile, docs, links);

      // If AI determined a calibrated overall score and adjustments, merge them
      const calibratedOverall =
        typeof ai.overallScore === "number" && ai.overallScore > 0
          ? Math.min(100, Math.max(0, Math.round(ai.overallScore)))
          : profile.overall;

      // Adjust dimensions if AI returned calibrations
      const adjustedDimensions = profile.dimensions.map((d) => {
        const aiScore = ai.dimensionAdjustments?.[d.key];
        if (typeof aiScore === "number" && !d.missing) {
          return { ...d, score: Math.min(100, Math.max(0, Math.round(aiScore))) };
        }
        return d;
      });

      // Calculate band from calibrated score
      let calculatedBand = profile.band;
      if (calibratedOverall >= 80) calculatedBand = "strong";
      else if (calibratedOverall >= 65) calculatedBand = "solid";
      else if (calibratedOverall >= 45) calculatedBand = "developing";
      else if (calibratedOverall > 0) calculatedBand = "early";

      finalProfile = {
        ...profile,
        overall: calibratedOverall,
        band: calculatedBand,
        dimensions: adjustedDimensions,
        studentLevel: ai.studentLevel || (calibratedOverall >= 80 ? "Level 4: Advanced Specialist" : calibratedOverall >= 60 ? "Level 3: Competent Practitioner" : "Level 2: Emerging Talent"),
        studentLevelDescription: ai.studentLevelDescription || undefined,
        narrative: ai.narrative || profile.narrative,
        strengths: ai.strengths?.length ? ai.strengths : profile.strengths,
        gaps: ai.gaps?.length ? ai.gaps : profile.gaps,
        nextSteps: ai.nextSteps?.length ? ai.nextSteps : profile.nextSteps,
      };
    }
  } else if (cached?.narrative && docs.length) {
    finalProfile = {
      ...profile,
      overall: typeof cached.overall === "number" && cached.overall > 0 ? cached.overall : profile.overall,
      band: cached.band || profile.band,
      studentLevel: cached.studentLevel,
      studentLevelDescription: cached.studentLevelDescription,
      narrative: cached.narrative,
      strengths: cached.strengths?.length ? cached.strengths : profile.strengths,
      gaps: cached.gaps?.length ? cached.gaps : profile.gaps,
      nextSteps: cached.nextSteps?.length ? cached.nextSteps : profile.nextSteps,
    };
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
        studentLevel: finalProfile.studentLevel || null,
        studentLevelDescription: finalProfile.studentLevelDescription || null,
        performanceUpdatedAt: finalProfile.computedAt,
      },
      { merge: true }
    );
  }

  return { ...snapshot, stale, persisted: mustPersist };
}

export async function GET(request: Request) {
  // Read-only view of the caller's own cached snapshot. It does not recompute,
  // so it stays a safe method.
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, { ...LIMITS.performanceProfile, uid: auth.user.uid });
  if (!limited.ok) return limited.response;

  const uid = auth.user.uid;
  try {
    const snap = await getAdminDb().doc(TRACKER_PATH(uid)).get();
    if (!snap.exists) {
      return NextResponse.json(
        { uid, computed: false, message: "No profile yet. POST to this route to build one." },
        { status: 404 }
      );
    }
    return NextResponse.json(snap.data());
  } catch (e) {
    console.error("[performance-profile] GET", (e as Error)?.message);
    return NextResponse.json({ error: "Could not read the performance profile" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const uid = auth.user.uid;

  const limited = enforceRateLimit(request, { ...LIMITS.performanceProfile, uid });
  if (!limited.ok) return limited.response;

  // `uid` in the body is ignored on purpose — an admin may pass one to recompute
  // another account; everyone else is always scoped to their own uid.
  let refresh = false;
  let force = false;
  let targetUid = uid;
  try {
    const body = (await request.json().catch(() => null)) as
      | { refreshNarrative?: boolean; force?: boolean; uid?: string }
      | null;
    if (body) {
      refresh = !!body.refreshNarrative;
      force = !!body.force;
      if (auth.user.isAdmin && typeof body.uid === "string" && body.uid.trim()) {
        targetUid = body.uid.trim();
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const data = await build(targetUid, refresh, force);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[performance-profile] POST", (e as Error)?.message);
    return NextResponse.json({ error: "Could not build the performance profile" }, { status: 500 });
  }
}
