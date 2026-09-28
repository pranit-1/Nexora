import type {
  DocumentInsights,
  PerformanceBand,
  PerformanceDimension,
  PerformanceDimensionKey,
  PerformanceProfile,
  ProfileLink,
  WalletCategory,
  WalletDocument,
} from "@/lib/types";
import { kindLabel } from "@/lib/profileLinks";
import { scoreRepository, aggregateGitHubScore, extractUsernameFromUrl } from "@/lib/github";
import { fetchCodingProfile, scoreCodingProfile, aggregateCodingScore } from "@/lib/codingPlatforms";

/**
 * The performance engine.
 *
 * Every number below is derived from the user's own wallet documents and the
 * facts parsed out of them (`DocumentInsights`). Nothing is a placeholder:
 * dimensions with no documents are reported as `missing`, left out of the
 * weighted average, and surfaced as gaps so the user knows what to upload next.
 *
 * Pure + dependency-free, so it runs on the server, in tests, and in the browser.
 */

export const ENGINE_VERSION = 2;

/**
 * `potentialFill` is what a dimension typically reaches once the user actually
 * fills it in, so `potential` is always >= `overall`. `oneDoc` is the rough
 * score a single new document buys, used for the "worth about +N points" hints.
 */
const DIMENSION_META: Record<
  PerformanceDimensionKey,
  { label: string; weight: number; potentialFill: number; oneDoc: number }
> = {
  academics: { label: "Academics", weight: 0.15, potentialFill: 75, oneDoc: 55 },
  credentials: { label: "Credentials", weight: 0.12, potentialFill: 70, oneDoc: 50 },
  recognition: { label: "Recognition", weight: 0.1, potentialFill: 70, oneDoc: 55 },
  projects: { label: "Projects", weight: 0.12, potentialFill: 75, oneDoc: 55 },
  skills: { label: "Technical Skills", weight: 0.12, potentialFill: 75, oneDoc: 50 },
  recency: { label: "Recency & Momentum", weight: 0.08, potentialFill: 70, oneDoc: 40 },
  network: { label: "Network & Visibility", weight: 0.07, potentialFill: 70, oneDoc: 35 },
  github: { label: "GitHub & Open Source", weight: 0.12, potentialFill: 80, oneDoc: 45 },
  coding: { label: "Coding Platforms", weight: 0.1, potentialFill: 80, oneDoc: 40 },
  readiness: { label: "Application Readiness", weight: 0.04, potentialFill: 70, oneDoc: 0 },
};

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(n)));

/** Trims a trailing period and lowercases the first letter, for inline use. */
function sentence(text: string): string {
  const v = text.trim().replace(/[.\s]+$/, "");
  if (!v) return v;
  return v.charAt(0).toLowerCase() + v.slice(1);
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function insightOf(doc: WalletDocument): DocumentInsights | undefined {
  return doc.insights;
}

function byCategory(docs: WalletDocument[], category: WalletCategory): WalletDocument[] {
  return docs.filter((d) => d.category === category);
}

function institutionsOf(docs: WalletDocument[]): string[] {
  return [...new Set(docs.map((d) => insightOf(d)?.institution).filter((v): v is string => !!v))];
}

function bestGpa(docs: WalletDocument[]): number | null {
  const values = docs.map((d) => insightOf(d)?.gpa).filter((v): v is number => typeof v === "number" && v > 0);
  return values.length ? Math.max(...values) : null;
}

function hasFreshDoc(docs: WalletDocument[], withinDays: number): boolean {
  return docs.some((d) => {
    const i = insightOf(d);
    const days = daysSince(i?.documentDate || d.uploadedAt);
    return days !== null && days >= 0 && days <= withinDays;
  });
}

// ─── DIMENSIONS ────────────────────────────────────────────────────────────

function scoreAcademics(docs: WalletDocument[]): PerformanceDimension {
  const meta = DIMENSION_META.academics;
  const results = byCategory(docs, "Results");
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!results.length) {
    return { key: "academics", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No marksheets or result documents in the wallet."] };
  }

  let score = 25 + Math.min(24, (results.length - 1) * 12);
  evidence.push(`${results.length} result document${results.length > 1 ? "s" : ""}`);

// Use marksheet-specific data: class 10/12, board, percentage, stream
  const class10 = results.find((d) => insightOf(d)?.marksheetClass === "10");
  const class12 = results.find((d) => insightOf(d)?.marksheetClass === "12");

  const pct10: number | null = class10 ? insightOf(class10)?.percentage ?? null : null;
  const pct12: number | null = class12 ? insightOf(class12)?.percentage ?? null : null;
  const bestPct: number | null = pct10 !== null && pct12 !== null
    ? (pct10 > pct12 ? pct10 : pct12)
    : pct10 ?? pct12 ?? null;
  if (bestPct != null) {
    score += bestPct >= 90 ? 30 : bestPct >= 80 ? 25 : bestPct >= 70 ? 20 : bestPct >= 60 ? 15 : bestPct >= 50 ? 10 : 5;
    evidence.push(`${bestPct}% (Class ${pct12 !== null ? "12" : "10"})`);
  } else {
    // Fallback to generic GPA/percentage
    const gpa = bestGpa(results);
    if (gpa !== null) {
      score += gpa >= 75 ? 25 : gpa >= 60 ? 18 : gpa >= 50 ? 10 : 4;
      const raw = results.map((d) => insightOf(d)?.gpaRaw).find(Boolean);
      evidence.push(`Academic score ${gpa}/100${raw ? ` (${raw})` : ""}`);
    } else {
      notes.push("No GPA or percentage could be read from these documents.");
    }
  }

  if (class12) {
    score += 8; // Class 12 is higher weight
    const board = insightOf(class12)?.marksheetBoard;
    if (board) evidence.push(`${board} Class 12`);
    const stream = insightOf(class12)?.marksheetStream;
    if (stream) evidence.push(`Stream: ${stream}`);
    const subjects = insightOf(class12)?.marksheetSubjects;
    if (subjects?.length) {
      score += Math.min(10, subjects.length * 2);
      evidence.push(`${subjects.length} subjects with marks`);
    }
  }
  if (class10) {
    score += 5;
    const board = insightOf(class10)?.marksheetBoard;
    if (board) evidence.push(`${board} Class 10`);
  }

  const institutions = institutionsOf(results);
  if (institutions.length) {
    score += 8;
    evidence.push(institutions[0]);
  }
  if (results.some((d) => insightOf(d)?.rollNumber)) {
    score += 6;
    evidence.push("Verified with roll / registration number");
  }
  if (results.some((d) => insightOf(d)?.field || insightOf(d)?.graduationYear)) {
    score += 6;
    const field = results.map((d) => insightOf(d)?.field).find(Boolean);
    if (field) evidence.push(field);
  }
  if (hasFreshDoc(results, 730)) score += 6;

  return { key: "academics", ...meta, score: clamp(score), docCount: results.length, missing: false, evidence, notes };
}

function scoreCredentials(docs: WalletDocument[]): PerformanceDimension {
  const meta = DIMENSION_META.credentials;
  const certs = byCategory(docs, "Certificates");
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!certs.length) {
    return { key: "credentials", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No certificates in the wallet."] };
  }

  let score = 30 + Math.min(36, (certs.length - 1) * 12);
  evidence.push(`${certs.length} certificate${certs.length > 1 ? "s" : ""}`);

  const issuers = [...new Set(certs.map((d) => insightOf(d)?.issuer || insightOf(d)?.institution).filter((v): v is string => !!v))];
  if (issuers.length >= 2) {
    score += 12;
    evidence.push(`${issuers.length} distinct issuers (${issuers.slice(0, 2).join(", ")})`);
  } else if (issuers.length === 1) {
    score += 6;
    evidence.push(`Issued by ${issuers[0]}`);
  } else {
    notes.push("Issuer of your certificates could not be read.");
  }

  if (hasFreshDoc(certs, 730)) {
    score += 12;
    evidence.push("At least one issued within the last 2 years");
  } else {
    notes.push("No certificate issued in the last 2 years.");
  }

  const skills = [...new Set(certs.flatMap((d) => insightOf(d)?.skills || []))];
  if (skills.length) {
    score += 10;
    evidence.push(`Skills evidenced: ${skills.slice(0, 4).join(", ")}`);
  }

  return { key: "credentials", ...meta, score: clamp(score), docCount: certs.length, missing: false, evidence, notes };
}

function scoreRecognition(docs: WalletDocument[]): PerformanceDimension {
  const meta = DIMENSION_META.recognition;
  const awards = byCategory(docs, "Awards");
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!awards.length) {
    return { key: "recognition", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No awards in the wallet."] };
  }

  let score = 35 + Math.min(45, (awards.length - 1) * 15);
  evidence.push(`${awards.length} award${awards.length > 1 ? "s" : ""}`);

  const levels = awards.map((d) => insightOf(d)?.awardLevel);
  const top = ["international", "national", "state", "university", "college"].find((l) => levels.includes(l as never));
  if (top === "international" || top === "national") {
    score += 15;
    evidence.push(`${top}-level award`);
  } else if (top) {
    score += 10;
    evidence.push(`${top}-level award`);
  } else {
    notes.push("Award level could not be detected.");
  }

  if (awards.some((d) => insightOf(d)?.issuer || insightOf(d)?.institution)) {
    score += 5;
    const issuer = awards.map((d) => insightOf(d)?.issuer).find(Boolean);
    if (issuer) evidence.push(`Recognised by ${issuer}`);
  }
  if (hasFreshDoc(awards, 1095)) score += 8;

  return { key: "recognition", ...meta, score: clamp(score), docCount: awards.length, missing: false, evidence, notes };
}

function scoreProjects(docs: WalletDocument[]): PerformanceDimension {
  const meta = DIMENSION_META.projects;
  const projects = byCategory(docs, "Projects");
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!projects.length) {
    return { key: "projects", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No project documents in the wallet."] };
  }

  let score = 30 + Math.min(45, (projects.length - 1) * 15);
  evidence.push(`${projects.length} project document${projects.length > 1 ? "s" : ""}`);

  const linked = projects.filter((d) => (insightOf(d)?.links || []).length > 0);
  if (linked.length) {
    score += 12;
    evidence.push(`${linked.length} project${linked.length > 1 ? "s" : ""} with a live link (repo / demo)`);
  } else {
    notes.push("None of your projects include a link to the repo or demo.");
  }

  const tech = [...new Set(projects.flatMap((d) => insightOf(d)?.technologies || []))];
  if (tech.length >= 2) {
    score += 13;
    evidence.push(`Tech breadth: ${tech.slice(0, 6).join(", ")}`);
  } else if (tech.length === 1) {
    score += 6;
    evidence.push(`Built with ${tech[0]}`);
  } else {
    notes.push("No technologies were detected in your project documents.");
  }

  if (projects.some((d) => (insightOf(d)?.skills || []).length)) score += 6;

  return { key: "projects", ...meta, score: clamp(score), docCount: projects.length, missing: false, evidence, notes };
}

function scoreReadiness(docs: WalletDocument[], needsReviewCount: number, links: ProfileLink[]): PerformanceDimension {
  const meta = DIMENSION_META.readiness;
  const resumes = byCategory(docs, "Resume");
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!docs.length) {
    return { key: "readiness", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["Wallet is empty — nothing to evaluate."] };
  }

  let score = 0;
  if (resumes.length) {
    score += 30;
    evidence.push("Resume on file");
    const newest = resumes
      .map((d) => daysSince(d.uploadedAt))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)[0];
    if (newest !== undefined && newest <= 365) {
      score += 10;
      evidence.push("Resume is up to date");
    } else {
      notes.push("Resume is more than a year old.");
    }
    const contact = resumes.some((d) => insightOf(d)?.contactEmail || insightOf(d)?.contactPhone);
    if (contact) {
      score += 12;
      evidence.push("Contact details present");
    } else {
      notes.push("No contact details found in the resume text.");
    }
    const inResume = resumes.some((d) => (insightOf(d)?.links || []).length > 0);
    if (inResume || links.length) {
      score += 12;
      evidence.push("Links to portfolio / profiles found");
    } else {
      notes.push("No portfolio, GitHub or LinkedIn link saved.");
    }
  } else {
    notes.push("No resume in the wallet — this is the highest-impact gap.");
  }

  // Saved public profiles count on their own: a LinkedIn the user curated by
  // hand is stronger evidence than a bare URL buried in a resume PDF.
  if (links.length) {
    const kinds = new Set(links.map((l) => l.kind));
    score += Math.min(14, 7 * kinds.size);
    evidence.push(
      kinds.size === 1
        ? `${links.length} public profile link${links.length > 1 ? "s" : ""} saved`
        : `${links.length} public profile links saved (${[...kinds].map((k) => kindLabel(k)).join(", ")})`
    );
  }

  if (needsReviewCount === 0) {
    score += 10;
    evidence.push("Every document is filed with confidence");
  } else {
    notes.push(`${needsReviewCount} document${needsReviewCount > 1 ? "s" : ""} still need category confirmation.`);
  }

  const stranded = docs.filter((d) => d.category === "Other").length;
  if (stranded === 0) {
    score += 8;
    evidence.push("No documents left in the unfiled bucket");
  } else {
    notes.push(`${stranded} document${stranded > 1 ? "s are" : " is"} still in "Other".`);
  }

  // A resume on its own is not readiness — supporting evidence matters too.
  if (docs.length >= 4) {
    score += 12;
    evidence.push(`${docs.length} documents uploaded as supporting evidence`);
  } else {
    notes.push(`Only ${docs.length} document${docs.length === 1 ? "" : "s"} uploaded — supporting evidence is thin.`);
  }

  return { key: "readiness", ...meta, score: clamp(Math.min(score, 92)), docCount: resumes.length || docs.length, missing: false, evidence, notes };
}

// ─── NEW DIMENSIONS ──────────────────────────────────────────────────────────

function scoreSkills(docs: WalletDocument[]): PerformanceDimension {
  const meta = DIMENSION_META.skills;
  const allSkills = [...new Set(docs.flatMap((d) => insightOf(d)?.skills || []))];
  const allTech = [...new Set(docs.flatMap((d) => insightOf(d)?.technologies || []))];
  const allLangs = [...new Set(docs.flatMap((d) => insightOf(d)?.languages || []))];
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!allSkills.length && !allTech.length && !allLangs.length) {
    return { key: "skills", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No skills, technologies or languages detected in your documents."] };
  }

  let score = 15;

  if (allTech.length) {
    score += Math.min(35, allTech.length * 5);
    evidence.push(`${allTech.length} technolog${allTech.length > 1 ? "ies" : "y"}: ${allTech.slice(0, 6).join(", ")}`);
  }
  if (allSkills.length) {
    score += Math.min(25, allSkills.length * 3);
    evidence.push(`${allSkills.length} skill${allSkills.length > 1 ? "s" : ""}: ${allSkills.slice(0, 5).join(", ")}`);
  }
  if (allLangs.length) {
    score += Math.min(15, allLangs.length * 5);
    evidence.push(`${allLangs.length} language${allLangs.length > 1 ? "s" : ""}: ${allLangs.join(", ")}`);
  }

  const hasResume = docs.some((d) => d.category === "Resume");
  if (hasResume && (allTech.length >= 3 || allSkills.length >= 5)) score += 10;

  return { key: "skills", ...meta, score: clamp(score), docCount: docs.filter((d) => insightOf(d)?.skills?.length || insightOf(d)?.technologies?.length).length, missing: false, evidence, notes };
}

function scoreRecency(docs: WalletDocument[]): PerformanceDimension {
  const meta = DIMENSION_META.recency;
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!docs.length) {
    return { key: "recency", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["Wallet is empty — nothing to evaluate."] };
  }

  let score = 10;

  const dates = docs.map((d) => insightOf(d)?.documentDate || d.uploadedAt).filter(Boolean) as string[];
  const recent = dates.filter((iso) => {
    const d = daysSince(iso);
    return d !== null && d >= 0 && d <= 180;
  });
  const somewhatRecent = dates.filter((iso) => {
    const d = daysSince(iso);
    return d !== null && d >= 0 && d <= 365;
  });
  const stale = dates.filter((iso) => {
    const d = daysSince(iso);
    return d === null || d < 0 || d > 365;
  });

  if (recent.length >= 3) {
    score += 35;
    evidence.push(`${recent.length} document${recent.length > 1 ? "s" : ""} updated in the last 6 months`);
  } else if (recent.length) {
    score += 15;
    evidence.push(`${recent.length} document${recent.length > 1 ? "s" : ""} updated in the last 6 months`);
  }

  if (somewhatRecent.length >= 3) {
    score += 20;
    evidence.push(`${somewhatRecent.length} document${somewhatRecent.length > 1 ? "s" : ""} updated in the last year`);
  } else if (somewhatRecent.length) {
    score += 10;
    evidence.push(`${somewhatRecent.length} document${somewhatRecent.length > 1 ? "s" : ""} updated in the last year`);
  }

  if (stale.length > docs.length * 0.5) {
    notes.push("More than half your documents are over a year old.");
  } else if (stale.length) {
    notes.push(`${stale.length} document${stale.length > 1 ? "s are" : " is"} over a year old.`);
  }

  const hasResume = docs.some((d) => d.category === "Resume");
  if (hasResume) {
    const resume = docs.find((d) => d.category === "Resume")!;
    const resumeDays = daysSince(insightOf(resume)?.documentDate || resume.uploadedAt);
    if (resumeDays !== null && resumeDays <= 90) {
      score += 15;
      evidence.push("Resume refreshed in the last 90 days");
    }
  }

  return { key: "recency", ...meta, score: clamp(score), docCount: dates.length, missing: false, evidence, notes };
}

function scoreNetwork(docs: WalletDocument[], links: ProfileLink[]): PerformanceDimension {
  const meta = DIMENSION_META.network;
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!links.length && !docs.some((d) => insightOf(d)?.links?.length)) {
    return { key: "network", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No public profiles or links found in your wallet."] };
  }

  let score = 5;

  if (links.length) {
    const kinds = new Set(links.map((l) => l.kind));
    score += Math.min(30, kinds.size * 12);
    evidence.push(`${links.length} public profile link${links.length > 1 ? "s" : ""} (${[...kinds].map((k) => kindLabel(k)).join(", ")})`);

    const hasLinkedIn = kinds.has("linkedin");
    const hasGitHub = kinds.has("github");
    const hasPortfolio = kinds.has("portfolio");
    if (hasLinkedIn && hasGitHub) score += 10;
    if (hasPortfolio) score += 8;
  }

  const docLinks = [...new Set(docs.flatMap((d) => insightOf(d)?.links || []))];
  if (docLinks.length) {
    score += Math.min(20, docLinks.length * 5);
    evidence.push(`${docLinks.length} additional link${docLinks.length > 1 ? "s" : ""} found in documents`);
  }

  if (docs.some((d) => d.category === "Awards")) score += 8;
  if (docs.some((d) => d.category === "Certificates")) score += 5;

  return { key: "network", ...meta, score: clamp(score), docCount: links.length + docLinks.length, missing: false, evidence, notes };
}

function scoreGitHub(githubData?: { score: number; signals: string[]; topRepos: any[] }): PerformanceDimension {
  const meta = DIMENSION_META.github;
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!githubData || githubData.score === 0) {
    return { key: "github", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No GitHub profile connected or no public repositories found."] };
  }

  let score = githubData.score;
  evidence.push(...githubData.signals);
  if (githubData.topRepos?.length) {
    evidence.push(`Top repo: ${githubData.topRepos[0].repo.name} (${githubData.topRepos[0].score}/100)`);
  }

  return { key: "github", ...meta, score: clamp(score), docCount: githubData.topRepos?.length || 0, missing: false, evidence, notes };
}

function scoreCodingPlatforms(codingData?: { score: number; byPlatform: Record<string, number>; signals: string[] }): PerformanceDimension {
  const meta = DIMENSION_META.coding;
  const evidence: string[] = [];
  const notes: string[] = [];

  if (!codingData || codingData.score === 0) {
    return { key: "coding", ...meta, score: 0, docCount: 0, missing: true, evidence, notes: ["No coding platform profiles connected (LeetCode, CodeChef, Codeforces, etc.)."] };
  }

  let score = codingData.score;
  evidence.push(...codingData.signals);
  const platforms = Object.entries(codingData.byPlatform).filter(([, s]) => s > 0);
  if (platforms.length) {
    evidence.push(`Active on: ${platforms.map(([p, s]) => `${p} (${s}/100)`).join(", ")}`);
  }

  return { key: "coding", ...meta, score: clamp(score), docCount: platforms.length, missing: false, evidence, notes };
}

// ─── PROFILE ───────────────────────────────────────────────────────────────

function bandFor(overall: number, docCount: number, coverage: number): PerformanceBand {
  if (!docCount) return "empty";
  if (overall >= 85 && coverage >= 80) return "strong";
  if (overall >= 70) return "solid";
  if (overall >= 50) return "developing";
  return "early";
}

const BAND_COPY: Record<PerformanceBand, string> = {
  strong: "Strong profile",
  solid: "Solid profile",
  developing: "Developing profile",
  early: "Early-stage profile",
  empty: "No documents yet",
};

export function bandLabel(band: PerformanceBand): string {
  return BAND_COPY[band];
}

function buildNarrative(
  overall: number,
  band: PerformanceBand,
  coverage: number,
  potential: number,
  dimensions: PerformanceDimension[],
  docCount: number
): string {
  if (!docCount) {
    return "Your wallet is empty, so there is nothing to score yet. Upload your resume and a few supporting documents — the profile rebuilds itself from whatever you add.";
  }
  const ranked = [...dimensions].filter((d) => !d.missing).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const weakest = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const missing = dimensions.filter((d) => d.missing);
  const parts: string[] = [];

  parts.push(`${BAND_COPY[band]} — ${overall}/100 across ${docCount} document${docCount > 1 ? "s" : ""} (${coverage}% of your profile backed by evidence).`);
  if (best) {
    parts.push(`Your strongest area is ${best.label.toLowerCase()} at ${best.score}/100 — ${best.evidence[0] || "supported by your uploads"}.`);
  }
  if (weakest) {
    parts.push(`${weakest.label} is your weakest proven area at ${weakest.score}/100${weakest.notes[0] ? ` (${sentence(weakest.notes[0])})` : ""}.`);
  }
  if (missing.length) {
    parts.push(`Unproven: ${missing.map((d) => d.label).join(", ")}. Filling those in would lift the profile to about ${potential}/100.`);
  }
  return parts.join(" ");
}

/**
 * Turn a wallet into a scored, explainable performance profile.
 * Deterministic: same documents always produce the same numbers.
 */
export function computePerformanceProfile(
  docs: WalletDocument[],
  profileLinks: ProfileLink[] = [],
  githubData?: { score: number; signals: string[]; topRepos: any[] },
  codingData?: { score: number; byPlatform: Record<string, number>; signals: string[] }
): PerformanceProfile {
  const valid = (docs || []).filter((d) => d && d.id);
  const links = (profileLinks || []).filter((l) => l && l.url);
  const needsReviewCount = valid.filter((d) => d.categoryNeedsReview).length;

  const categoryCounts: Partial<Record<WalletCategory, number>> = {};
  for (const d of valid) {
    categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
  }

  const dimensions: PerformanceDimension[] = [
    scoreAcademics(valid),
    scoreCredentials(valid),
    scoreRecognition(valid),
    scoreProjects(valid),
    scoreSkills(valid),
    scoreRecency(valid),
    scoreNetwork(valid, links),
    scoreReadiness(valid, needsReviewCount, links),
    scoreGitHub(githubData),
    scoreCodingPlatforms(codingData),
  ];

  const present = dimensions.filter((d) => !d.missing);
  const presentWeight = present.reduce((sum, d) => sum + d.weight, 0);
  const overall = presentWeight > 0
    ? clamp(present.reduce((sum, d) => sum + d.score * d.weight, 0) / presentWeight)
    : 0;

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const potential = clamp(
    Math.max(
      overall,
      dimensions.reduce((sum, d) => sum + (d.missing ? DIMENSION_META[d.key].potentialFill : d.score) * d.weight, 0) / totalWeight
    )
  );

  const coverage = clamp(((dimensions.length - dimensions.filter((d) => d.missing).length) / dimensions.length) * 100);
  const band = bandFor(overall, valid.length, coverage);

  const strengths = present
    .filter((d) => d.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((d) => `${d.label}: ${d.evidence[0] || `scored ${d.score}/100`}`);

  const gaps: string[] = [];
  const nextSteps: string[] = [];
  const hasResume = valid.some((d) => d.category === "Resume");
  const hasLinks = links.length > 0;
  const hasSkills = valid.some((d) => insightOf(d)?.skills?.length || insightOf(d)?.technologies?.length);
  const ADD_MORE: Record<PerformanceDimensionKey, string> = {
    academics: "Add another marksheet or transcript",
    credentials: "Add another certificate",
    recognition: "Add another award or appreciation letter",
    projects: "Add another project, ideally with a repo or demo link",
    skills: !hasSkills
      ? "Add skills/technologies to your resume or project documents"
      : "Broaden your tech stack (frameworks, tools, cloud, testing)",
    recency: "Upload recent documents (marksheets, certificates, updated resume)",
    network: "Add LinkedIn, GitHub, and a portfolio link to your wallet",
    github: "Connect your GitHub profile and showcase your best repositories",
    coding: "Add your LeetCode, CodeChef, or Codeforces profile",
    readiness: !hasResume
      ? "Upload your resume"
      : !hasLinks
      ? "Save your public profile links in the wallet (LinkedIn, GitHub, portfolio)"
      : "Add your email, phone number and profile links to the resume so it can be read automatically",
  };
  for (const d of dimensions) {
    if (d.missing) {
      gaps.push(`No ${d.label.toLowerCase()} evidence yet — ${sentence(ADD_MORE[d.key])}.`);
      nextSteps.push(`${ADD_MORE[d.key]} (worth about +${Math.round(DIMENSION_META[d.key].weight * DIMENSION_META[d.key].oneDoc)} points)`);
    } else if (d.score < 60) {
      gaps.push(`${d.label} is only ${d.score}/100 — ${sentence(ADD_MORE[d.key])}${d.notes[0] ? ` (${sentence(d.notes[0])})` : ""}.`);
      nextSteps.push(ADD_MORE[d.key]);
    }
  }
  if (needsReviewCount > 0) {
    nextSteps.push(`Confirm the category on ${needsReviewCount} flagged document${needsReviewCount > 1 ? "s" : ""} in the wallet`);
  }

  if (!strengths.length && valid.length) {
    const top = present.sort((a, b) => b.score - a.score)[0];
    if (top) strengths.push(`Only proven area so far: ${top.label} at ${top.score}/100`);
  }

  const allTech = [...new Set(valid.flatMap((d) => insightOf(d)?.technologies || []))];
  const allSkills = [...new Set(valid.flatMap((d) => insightOf(d)?.skills || []))];
  const skillGaps = identifySkillGaps(allTech, allSkills, valid);
  const prepFocus = identifyPrepFocus(allTech, allSkills, valid, dimensions);

  return {
    overall,
    potential,
    band,
    coverage,
    docCount: valid.length,
    dimensions,
    strengths,
    gaps: gaps.slice(0, 6),
    nextSteps: nextSteps.slice(0, 5),
    narrative: buildNarrative(overall, band, coverage, potential, dimensions, valid.length),
    categoryCounts,
    needsReviewCount,
    profileLinks: links,
    topTechnologies: allTech.slice(0, 10),
    topSkills: allSkills.slice(0, 10),
    skillGaps,
    prepFocus,
    computedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}

/** Detects missing but commonly paired skills for a tech stack. */
function identifySkillGaps(tech: string[], skills: string[], docs: WalletDocument[]): string[] {
  const gaps: string[] = [];
  const has = new Set([...tech.map((t) => t.toLowerCase()), ...skills.map((s) => s.toLowerCase())]);
  const pairs: Record<string, string[]> = {
    react: ["typescript", "next.js", "testing-library"],
    vue: ["typescript", "pinia", "vitest"],
    node: ["express", "typescript", "postgresql", "redis"],
    python: ["django", "fastapi", "sqlalchemy", "pytest"],
    java: ["spring", "maven", "gradle", "junit"],
    go: ["gin", "gorm", "testing"],
    rust: ["tokio", "serde", "clap"],
    docker: ["kubernetes", "github actions", "terraform"],
    aws: ["lambda", "dynamodb", "cloudformation", "cdk"],
    sql: ["postgresql", "redis", "orm"],
    ml: ["pytorch", "tensorflow", "pandas", "numpy", "mlflow"],
    data: ["pandas", "sql", "tableau", "airflow", "dbt"],
  };
  for (const [primary, secondaries] of Object.entries(pairs)) {
    if (has.has(primary)) {
      const missing = secondaries.filter((s) => !has.has(s.toLowerCase()));
      if (missing.length) gaps.push(`${primary.toUpperCase()} stack: consider ${missing.slice(0, 2).join(", ")}`);
    }
  }
  const hasResume = docs.some((d) => d.category === "Resume");
  if (hasResume && !has.has("testing") && !has.has("jest") && !has.has("vitest")) {
    gaps.push("No testing framework detected — add Jest/Vitest/Pytest to your resume");
  }
  if (hasResume && !has.has("ci/cd") && !has.has("github actions") && !has.has("gitlab ci")) {
    gaps.push("No CI/CD pipeline mentioned — add GitHub Actions / GitLab CI");
  }
  return gaps.slice(0, 6);
}

/** Recommends concrete preparation focus areas. */
function identifyPrepFocus(tech: string[], skills: string[], docs: WalletDocument[], dimensions: PerformanceDimension[]): string[] {
  const focus: string[] = [];
  const has = new Set([...tech.map((t) => t.toLowerCase()), ...skills.map((s) => s.toLowerCase())]);

  const weak = dimensions.filter((d) => d.missing || d.score < 50).map((d) => d.key);
  if (weak.includes("academics")) focus.push("Add latest marksheet/transcript with visible GPA/percentage");
  if (weak.includes("projects")) focus.push("Document 1–2 projects with repo/demo links and tech stack");
  if (weak.includes("skills")) focus.push("List 5–8 core skills on your resume (frameworks, tools, languages)");
  if (weak.includes("recency")) focus.push("Refresh resume and 1–2 certificates uploaded in the last 90 days");
  if (weak.includes("network")) focus.push("Add LinkedIn + GitHub to wallet; publish a portfolio page");

  if (has.has("react") || has.has("next.js")) focus.push("Build a full-stack Next.js demo (auth, DB, API) for interviews");
  if (has.has("python") && (has.has("pandas") || has.has("numpy"))) focus.push("Showcase a data project: EDA + model + Streamlit/Gradio demo");
  if (has.has("ml") || has.has("pytorch") || has.has("tensorflow")) focus.push("Add a trained model card with metrics, dataset, and inference demo");
  if (has.has("node") || has.has("express")) focus.push("Deploy a REST API with docs (Swagger), tests, and Dockerfile");

  return focus.slice(0, 5);
}
