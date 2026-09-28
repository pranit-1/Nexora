/**
 * GitHub Repository Analyzer
 * Fetches and scores repositories from a user's GitHub profile.
 * Uses public GitHub API (no auth needed for public data, rate limited to 60/hr).
 * For authenticated requests, set GITHUB_TOKEN env var.
 */

export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  languages: Record<string, number>;
  topics: string[];
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  size: number;
  isFork: boolean;
  archived: boolean;
  license: string | null;
  openIssues: number;
  defaultBranch: string;
  url: string;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  publicRepos: number;
  followers: number;
  following: number;
  createdAt: string;
  url: string;
}

export interface RepoScore {
  repo: GitHubRepo;
  score: number;
  breakdown: {
    activity: number;
    popularity: number;
    complexity: number;
    relevance: number;
    maintenance: number;
  };
  signals: string[];
}

const GITHUB_API = "https://api.github.com";

async function ghFetch(path: string, token?: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Nexora-Performance-Analyzer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GITHUB_API}${path}`, { headers, next: { revalidate: 3600 } });
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub API rate limited");
    if (res.status === 404) throw new Error("Not found");
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function parseLanguages(langs: Record<string, number>): string[] {
  return Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 999999;
  return Math.floor((Date.now() - t) / 86400000);
}

function scoreActivity(repo: GitHubRepo): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const daysSincePush = daysSince(repo.pushedAt);
  if (daysSincePush <= 7) { score += 25; signals.push("Active this week"); }
  else if (daysSincePush <= 30) { score += 20; signals.push("Active this month"); }
  else if (daysSincePush <= 90) { score += 12; signals.push("Active this quarter"); }
  else if (daysSincePush <= 365) { score += 5; signals.push("Active this year"); }
  else { signals.push(`Inactive ${daysSincePush}d`); }

  const daysSinceUpdate = daysSince(repo.updatedAt);
  if (daysSinceUpdate <= 30) score += 5;

  if (!repo.archived) score += 5;
  else signals.push("Archived");

  if (repo.openIssues <= 5 && repo.openIssues > 0) score += 3;
  else if (repo.openIssues === 0) score += 5;

  return { score: Math.min(score, 35), signals };
}

function scorePopularity(repo: GitHubRepo): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (repo.stars >= 100) { score += 20; signals.push(`${repo.stars}★`); }
  else if (repo.stars >= 20) { score += 12; signals.push(`${repo.stars}★`); }
  else if (repo.stars >= 5) { score += 6; signals.push(`${repo.stars}★`); }

  if (repo.forks >= 50) { score += 10; signals.push(`${repo.forks} forks`); }
  else if (repo.forks >= 10) { score += 6; signals.push(`${repo.forks} forks`); }
  else if (repo.forks >= 3) { score += 3; }

  return { score: Math.min(score, 25), signals };
}

function scoreComplexity(repo: GitHubRepo): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const langCount = Object.keys(repo.languages || {}).length;
  if (langCount >= 5) { score += 10; signals.push(`${langCount} languages`); }
  else if (langCount >= 3) { score += 6; signals.push(`${langCount} languages`); }
  else if (langCount >= 2) { score += 3; }

  const topicCount = repo.topics?.length || 0;
  if (topicCount >= 5) { score += 8; signals.push(`${topicCount} topics`); }
  else if (topicCount >= 3) { score += 5; }
  else if (topicCount >= 1) { score += 2; }

  if (repo.size >= 10000) { score += 5; signals.push("Large codebase"); }
  else if (repo.size >= 2000) { score += 3; }

  if (repo.license) { score += 3; signals.push(`Licensed: ${repo.license}`); }

  return { score: Math.min(score, 25), signals };
}

function scoreRelevance(repo: GitHubRepo): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const desc = (repo.description || "").toLowerCase();
  const name = repo.name.toLowerCase();
  const topics = (repo.topics || []).map((t) => t.toLowerCase());
  const allText = `${desc} ${name} ${topics.join(" ")}`;

  const strongKeywords = [
    "fullstack", "full-stack", "backend", "frontend", "api", "microservice",
    "auth", "database", "docker", "kubernetes", "ci/cd", "testing",
    "ml", "machine-learning", "data", "analytics", "dashboard",
    "real-time", "websocket", "graphql", "rest", "payment"
  ];
  const matches = strongKeywords.filter((k) => allText.includes(k));
  if (matches.length >= 3) { score += 10; signals.push(`Relevant: ${matches.slice(0, 3).join(", ")}`); }
  else if (matches.length >= 1) { score += 5; signals.push(`Relevant: ${matches[0]}`); }

  return { score: Math.min(score, 15), signals };
}

function scoreMaintenance(repo: GitHubRepo): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const ageDays = daysSince(repo.createdAt);
  if (ageDays >= 365) { score += 5; signals.push(`${Math.floor(ageDays/365)}y old`); }
  else if (ageDays >= 180) { score += 3; }

  if (repo.defaultBranch !== "master") score += 2;

  return { score: Math.min(score, 10), signals };
}

export async function fetchGitHubUser(username: string, token?: string): Promise<GitHubUser> {
  return ghFetch(`/users/${username}`, token);
}

export async function fetchUserRepos(username: string, token?: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(`/users/${username}/repos?per_page=100&page=${page}&sort=pushed&direction=desc`, token);
    if (!batch.length) break;
    for (const r of batch) {
      if (r.fork && r.stars < 5) continue; // skip low-signal forks
      let languages: Record<string, number> = {};
      try {
        languages = await ghFetch(`/repos/${username}/${r.name}/languages`, token);
      } catch { /* ignore */ }
      repos.push({
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        languages,
        topics: r.topics || [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        pushedAt: r.pushed_at,
        size: r.size,
        isFork: r.fork,
        archived: r.archived,
        license: r.license?.spdx_id || null,
        openIssues: r.open_issues_count,
        defaultBranch: r.default_branch,
        url: r.html_url,
      });
    }
    if (batch.length < 100) break;
    page++;
    if (page > 5) break; // cap at 500 repos
  }
  return repos;
}

export async function fetchRepoLanguages(owner: string, repo: string, token?: string): Promise<Record<string, number>> {
  return ghFetch(`/repos/${owner}/${repo}/languages`, token);
}

export function scoreRepository(repo: GitHubRepo): RepoScore {
  const activity = scoreActivity(repo);
  const popularity = scorePopularity(repo);
  const complexity = scoreComplexity(repo);
  const relevance = scoreRelevance(repo);
  const maintenance = scoreMaintenance(repo);

  const total = activity.score + popularity.score + complexity.score + relevance.score + maintenance.score;
  const allSignals = [...activity.signals, ...popularity.signals, ...complexity.signals, ...relevance.signals, ...maintenance.signals];

  return {
    repo,
    score: Math.min(total, 100),
    breakdown: {
      activity: activity.score,
      popularity: popularity.score,
      complexity: complexity.score,
      relevance: relevance.score,
      maintenance: maintenance.score,
    },
    signals: allSignals,
  };
}

export function aggregateGitHubScore(scored: RepoScore[]): { total: number; topRepos: RepoScore[]; signals: string[]; langStats: Record<string, number> } {
  if (!scored.length) return { total: 0, topRepos: [], signals: ["No public repositories found"], langStats: {} };

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top5 = sorted.slice(0, 5);
  const avg = top5.reduce((s, r) => s + r.score, 0) / top5.length;

  const langStats: Record<string, number> = {};
  for (const r of scored) {
    for (const [lang, bytes] of Object.entries(r.repo.languages)) {
      langStats[lang] = (langStats[lang] || 0) + bytes;
    }
  }

  const signals: string[] = [];
  if (scored.some((r) => r.breakdown.activity >= 25)) signals.push("Regular commits");
  if (scored.some((r) => r.breakdown.popularity >= 15)) signals.push("Starred projects");
  if (scored.some((r) => r.breakdown.complexity >= 15)) signals.push("Multi-language codebases");
  if (scored.some((r) => r.breakdown.relevance >= 8)) signals.push("Production-relevant work");

  return { total: Math.round(avg), topRepos: top5, signals, langStats };
}

export function extractUsernameFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([a-zA-Z0-9_-]+)(?:\/|$)/i);
  return m ? m[1] : null;
}