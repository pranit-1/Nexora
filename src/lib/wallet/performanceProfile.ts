import type {
  DocumentInsights,
  PerformanceBand,
  PerformanceDimension,
  PerformanceDimensionKey,
  PerformanceProfile,
  WalletCategory,
  WalletDocument,
} from "@/lib/types";

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
  academics: { label: "Academics", weight: 0.25, potentialFill: 70, oneDoc: 55 },
  credentials: { label: "Credentials", weight: 0.2, potentialFill: 70, oneDoc: 50 },
  recognition: { label: "Recognition", weight: 0.15, potentialFill: 70, oneDoc: 55 },
  projects: { label: "Projects", weight: 0.2, potentialFill: 70, oneDoc: 55 },
  readiness: { label: "Application Readiness", weight: 0.2, potentialFill: 70, oneDoc: 0 },
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

  const gpa = bestGpa(results);
  if (gpa !== null) {
    score += gpa >= 75 ? 25 : gpa >= 60 ? 18 : gpa >= 50 ? 10 : 4;
    const raw = results.map((d) => insightOf(d)?.gpaRaw).find(Boolean);
    evidence.push(`Academic score ${gpa}/100${raw ? ` (${raw})` : ""}`);
  } else {
    notes.push("No GPA or percentage could be read from these documents.");
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

function scoreReadiness(docs: WalletDocument[], needsReviewCount: number): PerformanceDimension {
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
    const links = resumes.some((d) => (insightOf(d)?.links || []).length > 0);
    if (links) {
      score += 12;
      evidence.push("Links to portfolio / profiles found");
    } else {
      notes.push("No portfolio, GitHub or LinkedIn link in the resume.");
    }
  } else {
    notes.push("No resume in the wallet — this is the highest-impact gap.");
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
export function computePerformanceProfile(docs: WalletDocument[]): PerformanceProfile {
  const valid = (docs || []).filter((d) => d && d.id);
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
    scoreReadiness(valid, needsReviewCount),
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
  const ADD_MORE: Record<PerformanceDimensionKey, string> = {
    academics: "Add another marksheet or transcript",
    credentials: "Add another certificate",
    recognition: "Add another award or appreciation letter",
    projects: "Add another project, ideally with a repo or demo link",
    readiness: hasResume
      ? "Add your email, phone number and profile links to the resume so it can be read automatically"
      : "Upload your resume",
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
    computedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}
