// ─── Fellowships scraper ───────────────────────────────────────────
// Scrapes fellowship-specific listings without pre-filtering — all data
// is returned and filtered client-side per user choice.

import { fetchText, loadCheerio, cleanText, absoluteUrl, parseDeadline, stripHtml } from "./utils";
import type { ScrapedOpportunity } from "./types";

function decodeEntities(str: string): string {
  return str.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#039;/g, "'");
}

function parseRss(xml: string) {
  const items: { title: string; link: string; description: string }[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = (b.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const link = (b.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const desc = (b.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "").trim();
    items.push({ title: decodeEntities(title), link: decodeEntities(link), description: stripHtml(decodeEntities(desc)).slice(0, 300) });
  }
  return items;
}

const RSS_FEEDS = [
  { name: "ProFellow RSS", url: "https://www.profellow.com/feed/" },
  { name: "OpportunityDesk Fellowships", url: "https://opportunitydesk.org/category/fellowships/feed/" },
  { name: "Youth Opportunities Fellowships", url: "https://www.youthop.com/category/fellowships/feed" },
];

const HTML_PAGES = [
  { name: "ProFellow", url: "https://www.profellow.com/fellowships/" },
  { name: "OpportunityDesk Fellowships", url: "https://opportunitydesk.org/category/fellowships/" },
  { name: "YouthOp Fellowships", url: "https://www.youthop.com/category/fellowships" },
  { name: "DAAD Research Fellowships", url: "https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/?status=3&origin=4&subjectGrps=&daad=&q=&page=1&detail=&intention=&degree=&q=&fos=" },
  { name: "Mitacs Globalink", url: "https://www.mitacs.ca/en/programs/globalink" },
  { name: "Outreachy", url: "https://www.outreachy.org/apply/" },
  { name: "AAUW Fellowships", url: "https://www.aauw.org/resources/programs/fellowships-grants/" },
  { name: "SWE Scholarships", url: "https://swe.org/scholarships/" },
];

export async function scrapeFellowships(): Promise<ScrapedOpportunity[]> {
  const out: ScrapedOpportunity[] = [];

  // RSS
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml).slice(0, 30);
      for (const item of items) {
        if (!item.title || item.title.length < 8) continue;
        out.push({
          title: item.title.slice(0, 140),
          orgName: feed.name,
          description: item.description || `${item.title} — fellowship from ${feed.name}.`,
          eligibility: "Check official site for eligibility.",
          deadline: "Rolling — check official site",
          country: "Global",
          category: "Fellowships",
          field: "General",
          applyLink: item.link || feed.url,
          requiredDocuments: ["Resume", "Research Proposal"],
          sourceUrl: item.link || feed.url,
          sourceType: "trusted-feed",
          autoApprove: false,
          scraperName: feed.name,
        });
      }
    } catch (err: any) {
      console.warn(`[Scraper:FellowRSS:${feed.name}] failed:`, err.message);
    }
  }

  // HTML pages
  for (const page of HTML_PAGES) {
    try {
      const html = await fetchText(page.url);
      const $ = loadCheerio(html);
      const seen = new Set<string>();
      const cards = $("article, .card, [class*='card'], [class*='fellowship'], a[href*='/fellowship'], a[href*='/fellowships/']");
      if (cards.length === 0) {
        const links: { title: string; href: string }[] = [];
        $("a[href]").each((_, el) => {
          const t = cleanText($(el).text());
          const href = $(el).attr("href") || "";
          if (t.length >= 12 && t.length <= 170 && !/read more|click here|learn more/i.test(t)) {
            const lower = t.toLowerCase();
            // Prefer fellowship/scholarship/research related titles but don't hard-filter
            const key = lower;
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
            description: `${l.title} — fellowship from ${page.name}. Check official site for eligibility and deadline.`.slice(0, 300),
            eligibility: "Students, researchers, early-career professionals — check official site.",
            deadline: "Rolling — check official site",
            country: "Global",
            category: "Fellowships",
            field: "General",
            applyLink: l.href,
            requiredDocuments: ["Resume", "Statement of Purpose"],
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
        const deadlineRaw = cleanText($el.find("[class*='deadline'], [class*='date'], time").first().text());
        out.push({
          title: title.slice(0, 140),
          orgName: page.name,
          description: `${title} — fellowship from ${page.name}. Visit official page for details.`.slice(0, 300),
          eligibility: "Check official site for eligibility.",
          deadline: parseDeadline(deadlineRaw),
          country: "Global",
          category: "Fellowships",
          field: "General",
          applyLink: link,
          requiredDocuments: ["Resume", "Proposal"],
          sourceUrl: link,
          sourceType: "scraped",
          autoApprove: false,
          scraperName: page.name,
        });
      });
    } catch (err: any) {
      console.warn(`[Scraper:Fellowship:${page.name}] failed:`, err.message);
    }
  }

  const seen = new Set<string>();
  const deduped = out.filter((o) => {
    const k = o.title.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.slice(0, 60);
}
