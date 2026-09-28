/**
 * Public profile links — the URLs a user wants recruiters, and the AI, to see.
 * Anything from a LinkedIn profile to a random portfolio page counts, so nothing
 * here is allow-list restricted; the kind is only used for labelling and for
 * the performance score.
 */
import type { ProfileLinkKind } from "./types";

export const PROFILE_LINK_KINDS: ProfileLinkKind[] = [
  "linkedin",
  "github",
  "leetcode",
  "codechef",
  "codeforces",
  "hackerrank",
  "portfolio",
  "social",
  "website",
  "other",
];

const KIND_LABELS: Record<ProfileLinkKind, string> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  leetcode: "LeetCode",
  codechef: "CodeChef",
  codeforces: "Codeforces",
  hackerrank: "HackerRank",
  portfolio: "Portfolio",
  social: "Social",
  website: "Website",
  other: "Link",
};

const KIND_ACCENT: Record<ProfileLinkKind, string> = {
  linkedin: "text-[#0a66c2]",
  github: "text-foreground",
  leetcode: "text-[#FFA116]",
  codechef: "text-[#5B4638]",
  codeforces: "text-[#1F8ACB]",
  hackerrank: "text-[#2EC866]",
  portfolio: "text-primary",
  social: "text-success",
  website: "text-foreground-muted",
  other: "text-foreground-muted",
};

export function kindLabel(kind: ProfileLinkKind): string {
  return KIND_LABELS[kind] || KIND_LABELS.other;
}

export function kindAccent(kind: ProfileLinkKind): string {
  return KIND_ACCENT[kind] || KIND_ACCENT.other;
}

/** Hostname → kind. Ordered longest-first so subdomains are matched sensibly. */
const HOST_KINDS: Array<[RegExp, ProfileLinkKind]> = [
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)lnkd\.in$/, "linkedin"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)gitlab\.com$/, "github"],
  [/(^|\.)bitbucket\.org$/, "github"],
  [/(^|\.)leetcode\.com$/, "leetcode"],
  [/(^|\.)codechef\.com$/, "codechef"],
  [/(^|\.)codeforces\.com$/, "codeforces"],
  [/(^|\.)hackerrank\.com$/, "hackerrank"],
  [/(^|\.)behance\.net$/, "portfolio"],
  [/(^|\.)dribbble\.com$/, "portfolio"],
  [/(^|\.)dev\.to$/, "portfolio"],
  [/(^|\.)hashnode\.com$/, "portfolio"],
  [/(^|\.)codepen\.io$/, "portfolio"],
  [/(^|\.)notion\.site$/, "portfolio"],
  [/(^|\.)medium\.com$/, "portfolio"],
  [/(^|\.)substack\.com$/, "portfolio"],
  [/(^|\.)kaggle\.com$/, "portfolio"],
  [/(^|\.)figma\.com$/, "portfolio"],
  [/(^|\.)youtube\.com$/, "social"],
  [/(^|\.)youtu\.be$/, "social"],
  [/(^|\.)twitter\.com$/, "social"],
  [/(^|\.)x\.com$/, "social"],
  [/(^|\.)instagram\.com$/, "social"],
  [/(^|\.)facebook\.com$/, "social"],
  [/(^|\.)threads\.net$/, "social"],
  [/(^|\.)mastodon\.social$/, "social"],
  [/(^|\.)t\.me$/, "social"],
];

/** TLDs that almost always belong to a single person's own site. */
const PERSONAL_TLDS = new Set([
  "dev", "me", "io", "page", "site", "website", "xyz", "online", "tech",
  "design", "studio", "link", "bio", "live", "blog", "space", "fun", "host",
]);

/** Short one-liners shown next to the input so the user knows what to paste. */
const DOMAIN_HINTS: Array<[RegExp, ProfileLinkKind]> = [
  [/\b(portfolio|works|homepage)\b/, "portfolio"],
  [/\b(profile|cv|resume|contact|about)\b/, "website"],
  [/\b(repo|projects?|code)\b/, "github"],
  [/\b(feed|timeline|posts?)\b/, "social"],
  [/\b(public|public-?site)\b/, "portfolio"],
];

export interface LinkParseResult {
  url: string;
  host: string;
  kind: ProfileLinkKind;
  label: string;
  ok: boolean;
  error?: string;
}

/**
 * Accepts what people actually type — "linkedin.com/in/nikhil", "https://x.com/me",
 * "github.com/you" — and turns it into a clean, absolute https URL.
 */
export function parseProfileLink(raw: string): LinkParseResult {
  const trimmed = (raw || "").trim();
  const fail = (error: string): LinkParseResult => ({ url: "", host: "", kind: "other", label: "", ok: false, error });

  if (!trimmed) return fail("Paste a link first.");
  if (trimmed.length > 500) return fail("That link is too long.");

  // Strip anything that would be pasted alongside the URL.
  const cleaned = trimmed.replace(/^[\s"'`<(]+/, "").replace(/[\s"'`>).,;:]+$/, "");

  // Catch a pasted non-web scheme before we blindly prepend https://. Covers both
  // "ftp://host" and the `//`-less forms (mailto:, tel:, javascript:, data:).
  const scheme = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return fail(`Only http and https links can be saved, not ${scheme[1]}:`);
  }

  const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return fail("That does not look like a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return fail("Only http and https links can be saved.");
  }
  // Never store credentials. "https://user:pass@host" parses fine, so it has to be
  // rejected explicitly or a pasted secret would end up saved in the database.
  if (parsed.username || parsed.password) {
    return fail("Remove the username and password from that link before saving it.");
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (!host || !host.includes(".")) {
    return fail("Add the full domain, for example linkedin.com/in/yourname.");
  }

  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const kind = detectKind(host);
  return {
    url: `https://${host}${path}${parsed.search}${parsed.hash}`,
    host,
    kind,
    label: kindLabel(kind),
    ok: true,
  };
}

export function detectKind(hostOrUrl: string): ProfileLinkKind {
  const value = (hostOrUrl || "").trim().toLowerCase();
  if (!value) return "other";
  const host = value.includes("://") || value.includes("/") ? hostOf(value) : value.replace(/^www\./, "");

  for (const [re, kind] of HOST_KINDS) {
    if (re.test(host)) return kind;
  }
  if (/\.(edu|ac\.[a-z]{2})$/.test(host)) return "portfolio";
  for (const [re, kind] of DOMAIN_HINTS) {
    if (re.test(host)) return kind;
  }
  // name.dev, yourname.me, studio.xyz, sub.yourname.io — a personal domain.
  const labels = host.split(".");
  if (PERSONAL_TLDS.has(labels[labels.length - 1])) return "portfolio";
  return "website";
}

function hostOf(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.split("/")[0].replace(/^www\./, "").toLowerCase();
  }
}

/** Strips the scheme and any trailing slash, for compact display. */
export function displayUrl(url: string): string {
  return (url || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^www\./i, "");
}

/** Two links pointing at the same place. Normalises trailing slashes. */
export function isSameLink(a: string, b: string): boolean {
  const norm = (u: string) => (u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^www\./, "");
  return norm(a) === norm(b);
}

/** One-tap starting points for users who do not have a link handy. */
export const LINK_SUGGESTIONS: Array<{ kind: ProfileLinkKind; label: string; placeholder: string }> = [
  { kind: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/yourname" },
  { kind: "github", label: "GitHub", placeholder: "github.com/yourname" },
  { kind: "portfolio", label: "Portfolio", placeholder: "yourname.dev" },
  { kind: "social", label: "Other", placeholder: "behance.net/you" },
];

/** LinkedIn needs a profile path — the bare domain is not a profile anyone can open. */
export function needsProfilePath(kind: ProfileLinkKind, url: string): boolean {
  return kind === "linkedin" && !/\/in\/|\/pub\//i.test(url);
}
