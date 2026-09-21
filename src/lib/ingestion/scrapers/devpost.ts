// ─── Devpost — official hackathon API (trusted-feed) ───────────────────
import { fetchJson, parseDeadline } from "./utils";
import type { ScrapedOpportunity } from "./types";

const ENDPOINTS = [
  "https://devpost.com/api/hackathons?status[]=open&order_by=recently-added&per_page=40",
  "https://devpost.com/api/hackathons?status[]=upcoming&order_by=recently-added&per_page=30",
  "https://devpost.com/api/hackathons?status[]=recent&order_by=recently-added&per_page=20",
];

export async function scrapeDevpost(): Promise<ScrapedOpportunity[]> {
  const out: ScrapedOpportunity[] = [];
  const seen = new Set<string>();

  for (const url of ENDPOINTS) {
    try {
      const data = await fetchJson(url);
      const hackathons: any[] = data?.hackathons || [];
      for (const h of hackathons) {
        const link: string = h.url || h.hackathon_url || "";
        if (!link || seen.has(link)) continue;
        seen.add(link);

        // Prize parsing: h.prize_amount may be like "$10,000" or ""
        const prize = h.prize_amount ? `Prize pool: ${h.prize_amount}` : "";
        const themes: string = (h.themes || []).map((t: any) => t.name).join(", ");
        const dateStr: string = h.submission_period_dates || h.displayed_location || "";

        out.push({
          title: (h.title || "Untitled Hackathon").trim(),
          orgName: (h.organization_name || "Devpost").trim() || "Devpost",
          description:
            cleanDesc(h.tagline || h.description || "") ||
            `Hackathon on Devpost. ${themes ? `Themes: ${themes}. ` : ""}${prize}`.trim() ||
            "Join this hackathon on Devpost and build something amazing.",
          eligibility: h.eligibility || "Open to all students and developers — check official page for details.",
          deadline: parseDeadline(h.submission_period_dates),
          country: typeof h.displayed_location === "string" && h.displayed_location.includes("Online")
            ? "Global"
            : typeof h.displayed_location === "object"
            ? (h.displayed_location?.location || "Global")
            : String(h.displayed_location || "Global"),
          category: "Hackathons",
          field: themes ? themes.split(",")[0].trim() || "Computer Science" : "Computer Science",
          applyLink: link,
          requiredDocuments: ["Resume", "Project submission"],
          sourceUrl: link,
          sourceType: "trusted-feed",
          autoApprove: true,
          scraperName: "Devpost",
        });
      }
    } catch (err: any) {
      console.warn(`[Scraper:Devpost] ${url} failed:`, err.message);
    }
  }

  return out.slice(0, 60);
}

function cleanDesc(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length > 280) return t.slice(0, 277) + "...";
  return t;
}
