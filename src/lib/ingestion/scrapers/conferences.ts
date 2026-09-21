// ─── Conferences scraper ─────────────────────────────────────────────
// Aggregates conferences from multiple sources (cheerio + RSS)
// Sources are scraped WITHOUT pre-filtering — all entries are returned
// and the user filters client-side (category-wise)

import { fetchText, loadCheerio, cleanText, absoluteUrl, parseDeadline, stripHtml } from "./utils";
import type { ScrapedOpportunity } from "./types";

interface ConfPage {
  name: string;
  url: string;
  category: "Conferences" | "Fellowships";
}

const RSS_FEEDS = [
  { name: "AllConferenceAlert RSS", url: "https://allconferencealert.net/rss.xml" },
  { name: "10times RSS", url: "https://10times.com/rss" },
];

function decodeEntities(str: string): string {
  return str.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#039;/g, "'");
}

function parseRss(xml: string) {
  const items: { title: string; link: string; description: string }[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const description = (block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "").trim();
    items.push({ title: decodeEntities(title), link: decodeEntities(link), description: stripHtml(decodeEntities(description)).slice(0, 300) });
  }
  return items;
}

const HTML_PAGES: ConfPage[] = [
  { name: "10times Technology", url: "https://10times.com/technology", category: "Conferences" },
  { name: "WikiCFP", url: "http://www.wikicfp.com/cfp/", category: "Conferences" },
  { name: "AllConferenceAlert", url: "https://allconferencealert.com/", category: "Conferences" },
  { name: "ConferenceAlerts", url: "https://conferencealerts.com/", category: "Conferences" },
  { name: "IEEE Conferences", url: "https://conferences.ieee.org/conferences", category: "Conferences" },
  { name: "OpportunityDesk Conferences", url: "https://opportunitydesk.org/category/conferences/", category: "Conferences" },
  { name: "Youth Opportunities Conferences", url: "https://www.youthop.com/conferences", category: "Conferences" },
];

export async function scrapeConferences(): Promise<ScrapedOpportunity[]> {
  const out: ScrapedOpportunity[] = [];

  // ── RSS feeds first (fast, reliable) ──
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml).slice(0, 30);
      for (const item of items) {
        if (!item.title || item.title.length < 8) continue;
        out.push({
          title: item.title.slice(0, 140),
          orgName: feed.name,
          description: item.description || `${item.title} — conference listed on ${feed.name}.`,
          eligibility: "Check official site for eligibility and registration details.",
          deadline: "Rolling — check official site",
          country: "Global",
          category: "Conferences",
          field: "General",
          applyLink: item.link || feed.url,
          requiredDocuments: ["Abstract", "Resume"],
          sourceUrl: item.link || feed.url,
          sourceType: "trusted-feed",
          autoApprove: false,
          scraperName: feed.name,
        });
      }
    } catch (err: any) {
      console.warn(`[Scraper:ConfRSS:${feed.name}] failed:`, err.message);
    }
  }

  // ── HTML pages (cheerio) ──
  for (const page of HTML_PAGES) {
    try {
      const html = await fetchText(page.url);
      const $ = loadCheerio(html);
      const seen = new Set<string>();

      // Try generic article/card selectors
      const cards = $("article, .card, [class*='card'], .event, [class*='event'], .conference-card, a[href*='/conference'], a[href*='/event']");
      // If nothing, fallback to all links with meaningful text
      if (cards.length === 0) {
        const links: { title: string; href: string }[] = [];
        $("a[href]").each((_, el) => {
          const t = cleanText($(el).text());
          const href = $(el).attr("href") || "";
          if (t.length >= 12 && t.length <= 160 && !/read more|click here|view all/i.test(t)) {
            const key = t.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              links.push({ title: t, href: absoluteUrl(href, page.url) });
            }
          }
        });
        for (const l of links.slice(0, 20)) {
          out.push({
            title: l.title.slice(0, 140),
            orgName: page.name,
            description: `${l.title} — conference from ${page.name}. Check official site for dates and CFP deadline.`.slice(0, 300),
            eligibility: "Researchers, students, professionals — check official site.",
            deadline: "Rolling — check official site",
            country: "Global",
            category: page.category,
            field: "General",
            applyLink: l.href,
            requiredDocuments: ["Abstract"],
            sourceUrl: l.href,
            sourceType: "scraped",
            autoApprove: false,
            scraperName: page.name,
          });
        }
        continue;
      }

      cards.slice(0, 30).each((_, el) => {
        const $el = $(el);
        const title = cleanText($el.find("h2, h3, .title, [class*='title'], .entry-title").first().text() || $el.text().split("\n")[0] || "");
        if (!title || title.length < 10 || title.length > 180) return;
        const key = title.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const href = $el.attr("href") || $el.find("a").first().attr("href") || "";
        const link = href ? absoluteUrl(href, page.url) : page.url;
        const deadlineRaw = cleanText($el.find("[class*='deadline'], [class*='date'], time, [class*='cfp']").first().text());
        out.push({
          title: title.slice(0, 140),
          orgName: page.name,
          description: `${title} — conference from ${page.name}. Visit official page for CFP, dates and registration.`.slice(0, 300),
          eligibility: "Open to researchers and students — check official site.",
          deadline: parseDeadline(deadlineRaw),
          country: "Global",
          category: page.category,
          field: "General",
          applyLink: link,
          requiredDocuments: ["Abstract"],
          sourceUrl: link,
          sourceType: "scraped",
          autoApprove: false,
          scraperName: page.name,
        });
      });
    } catch (err: any) {
      console.warn(`[Scraper:Conference:${page.name}] failed:`, err.message);
    }
  }

  // dedup by title
  const seen = new Set<string>();
  const deduped = out.filter((o) => {
    const k = o.title.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.slice(0, 60);
}
