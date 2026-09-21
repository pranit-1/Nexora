// ─── Jobs & Internships via free public APIs (no auth needed) ─────────
// - Arbeitnow:  https://www.arbeitnow.com/api/job-board-api  (global jobs)
// - Remotive:   https://remotive.com/api/remote-jobs         (remote jobs)
// Both are auto-approved as trusted-feed.

import { fetchJson, parseDeadline } from "./utils";
import type { ScrapedOpportunity } from "./types";

export async function scrapeJobsApis(): Promise<ScrapedOpportunity[]> {
  const out: ScrapedOpportunity[] = [];

  // ── Arbeitnow ───────────────────────────────────────────────────────
  try {
    const data = await fetchJson("https://www.arbeitnow.com/api/job-board-api");
    const jobs: any[] = data?.data || [];
    for (const j of jobs.slice(0, 30)) {
      const link: string = j.url || j.slug ? `https://www.arbeitnow.com/view/${j.slug}` : "https://www.arbeitnow.com";
      const isInternship = /intern/i.test(j.title || "") || /intern/i.test(j.description || "");
      out.push({
        title: (j.title || "Job Opening").trim().slice(0, 140),
        orgName: (j.company_name || "Arbeitnow Employer").trim(),
        description: stripDesc(j.description || j.title || ""),
        eligibility: "Check official listing for eligibility and requirements.",
        deadline: parseDeadline(j.created_at),
        country: j.location || "Global",
        category: isInternship ? "Internships" : "Internships",
        field: inferField(j.title + " " + (j.tags || []).join(" ")),
        applyLink: link,
        requiredDocuments: ["Resume", "Cover Letter"],
        sourceUrl: link,
        sourceType: "trusted-feed",
        autoApprove: false, // still needs a quick human glance — external job board
        scraperName: "Arbeitnow",
      });
    }
  } catch (err: any) {
    console.warn("[Scraper:Arbeitnow] failed:", err.message);
  }

  // ── Remotive (remote jobs — great for students wanting remote work) ─
  try {
    const data = await fetchJson("https://remotive.com/api/remote-jobs?limit=10");
    const jobs: any[] = data?.jobs || [];
    for (const j of jobs.slice(0, 30)) {
      if (!j.title || !j.url) continue;
      const isInternship = /intern/i.test(j.title) || (j.job_type || "").toLowerCase().includes("intern");
      out.push({
        title: j.title.trim().slice(0, 140),
        orgName: (j.company_name || "Remotive Employer").trim(),
        description: stripDesc(j.description || j.title || ""),
        eligibility: j.candidate_required_location || "Remote — open globally, check listing.",
        deadline: parseDeadline(j.publication_date),
        country: "Global",
        category: isInternship ? "Internships" : "Internships",
        field: inferField(j.title + " " + (j.category || "") + " " + (j.tags || []).join(" ")),
        applyLink: j.url,
        requiredDocuments: ["Resume"],
        sourceUrl: j.url,
        sourceType: "trusted-feed",
        autoApprove: false,
        scraperName: "Remotive",
      });
    }
  } catch (err: any) {
    console.warn("[Scraper:Remotive] failed:", err.message);
  }

  // Dedup by applyLink
  const seen = new Set<string>();
  return out.filter((o) => {
    if (seen.has(o.applyLink)) return false;
    seen.add(o.applyLink);
    return true;
  }).slice(0, 60);
}

function stripDesc(html: string): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > 300) return text.slice(0, 297) + "...";
  return text || "Job opportunity — check the official listing for full details.";
}

function inferField(text: string): string {
  const t = text.toLowerCase();
  if (/(software|developer|engineer|programming|coding|backend|frontend|full.?stack)/.test(t)) return "Computer Science";
  if (/(data|machine learning|ai|analytics|python|r)/.test(t)) return "Data Science";
  if (/(design|ui|ux|figma|creative)/.test(t)) return "Design";
  if (/(marketing|sales|content|seo|social)/.test(t)) return "Marketing";
  if (/(finance|accounting|analyst)/.test(t)) return "Finance";
  if (/(research|lab|science|phd)/.test(t)) return "Research";
  return "General";
}
