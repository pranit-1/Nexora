/**
 * Coding Platform Profile Analyzer
 * Parses and scores profiles from LeetCode, CodeChef, Codeforces, GFG, HackerRank, etc.
 * Uses public profile pages (no official APIs for most).
 */

export interface CodingProfile {
  platform: "leetcode" | "codechef" | "codeforces" | "geeksforgeeks" | "hackerrank" | "atcoder" | "other";
  username: string;
  url: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  problemsSolved?: number;
  easySolved?: number;
  mediumSolved?: number;
  hardSolved?: number;
  contestCount?: number;
  badges?: string[];
  skills?: string[];
  lastActive?: string;
  rawData?: Record<string, unknown>;
}

export interface PlatformScore {
  profile: CodingProfile;
  score: number;
  breakdown: {
    volume: number;
    difficulty: number;
    consistency: number;
    competitiveness: number;
  };
  signals: string[];
}

const PLATFORM_PATTERNS: Array<{ platform: CodingProfile["platform"]; regex: RegExp }> = [
  { platform: "leetcode", regex: /leetcode\.com\/([a-zA-Z0-9_-]+)/i },
  { platform: "codechef", regex: /codechef\.com\/users\/([a-zA-Z0-9_-]+)/i },
  { platform: "codeforces", regex: /codeforces\.com\/profile\/([a-zA-Z0-9_-]+)/i },
  { platform: "geeksforgeeks", regex: /geeksforgeeks\.org\/user\/([a-zA-Z0-9_-]+)/i },
  { platform: "hackerrank", regex: /hackerrank\.com\/([a-zA-Z0-9_-]+)/i },
  { platform: "atcoder", regex: /atcoder\.jp\/users\/([a-zA-Z0-9_-]+)/i },
];

export function detectPlatform(url: string): { platform: CodingProfile["platform"]; username: string } | null {
  for (const { platform, regex } of PLATFORM_PATTERNS) {
    const m = url.match(regex);
    if (m) return { platform, username: m[1] };
  }
  return null;
}

async function fetchLeetCode(username: string): Promise<CodingProfile> {
  // LeetCode GraphQL endpoint (public)
  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        username
        profile { ranking userAvatar realName aboutMe }
        submitStats { acSubmissionNum { difficulty count submissions } }
        contestBadge { name }
      }
      userContestRanking(username: $username) { rating attendedContestsCount globalRanking }
    }
  `;
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Nexora" },
      body: JSON.stringify({ query, variables: { username } }),
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("LeetCode fetch failed");
    const data = await res.json();
    const u = data.data?.matchedUser;
    const c = data.data?.userContestRanking;
    if (!u) throw new Error("User not found");

    const stats = u.submitStats?.acSubmissionNum || [];
    const easy = stats.find((s: any) => s.difficulty === "Easy")?.count || 0;
    const medium = stats.find((s: any) => s.difficulty === "Medium")?.count || 0;
    const hard = stats.find((s: any) => s.difficulty === "Hard")?.count || 0;
    const total = stats.find((s: any) => s.difficulty === "All")?.count || easy + medium + hard;

    return {
      platform: "leetcode",
      username,
      url: `https://leetcode.com/${username}/`,
      rating: c?.rating || undefined,
      maxRating: c?.rating || undefined,
      rank: c?.globalRanking ? `#${c.globalRanking}` : undefined,
      problemsSolved: total,
      easySolved: easy,
      mediumSolved: medium,
      hardSolved: hard,
      contestCount: c?.attendedContestsCount || 0,
      badges: u.contestBadge?.map((b: any) => b.name) || [],
    };
  } catch {
    return { platform: "leetcode", username, url: `https://leetcode.com/${username}/`, rawData: { error: "fetch failed" } };
  }
}

async function fetchCodeChef(username: string): Promise<CodingProfile> {
  try {
    const res = await fetch(`https://codechef-api.vercel.app/${username}`, {
      headers: { "User-Agent": "Nexora" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("CodeChef API failed");
    const data = await res.json();
    return {
      platform: "codechef",
      username,
      url: `https://codechef.com/users/${username}`,
      rating: data.currentRating,
      maxRating: data.highestRating,
      rank: data.globalRank ? `#${data.globalRank}` : undefined,
      problemsSolved: data.totalProblemsSolved?.total,
      contestCount: data.contestCount,
      badges: data.badges?.map((b: any) => b.name) || [],
    };
  } catch {
    return { platform: "codechef", username, url: `https://codechef.com/users/${username}`, rawData: { error: "fetch failed" } };
  }
}

async function fetchCodeforces(username: string): Promise<CodingProfile> {
  try {
    const [userRes, ratingRes] = await Promise.all([
      fetch(`https://codeforces.com/api/user.info?handles=${username}`, { next: { revalidate: 3600 } }),
      fetch(`https://codeforces.com/api/user.rating?handle=${username}`, { next: { revalidate: 3600 } }),
    ]);
    const userData = await userRes.json();
    const ratingData = await ratingRes.json();
    if (userData.status !== "OK") throw new Error("CF user not found");

    const u = userData.result[0];
    const ratings = ratingData.result || [];
    const maxRating = ratings.length ? Math.max(...ratings.map((r: any) => r.newRating)) : u.rating;
    const contestCount = ratings.length;

    return {
      platform: "codeforces",
      username,
      url: `https://codeforces.com/profile/${username}`,
      rating: u.rating,
      maxRating,
      rank: u.rank,
      problemsSolved: undefined, // CF doesn't expose total solved easily
      contestCount,
    };
  } catch {
    return { platform: "codeforces", username, url: `https://codeforces.com/profile/${username}`, rawData: { error: "fetch failed" } };
  }
}

async function fetchGFG(username: string): Promise<CodingProfile> {
  try {
    // GFG doesn't have a public API, would need scraping
    return { platform: "geeksforgeeks", username, url: `https://geeksforgeeks.org/user/${username}`, rawData: { note: "no public API" } };
  } catch {
    return { platform: "geeksforgeeks", username, url: `https://geeksforgeeks.org/user/${username}`, rawData: { error: "fetch failed" } };
  }
}

async function fetchHackerRank(username: string): Promise<CodingProfile> {
  return { platform: "hackerrank", username, url: `https://hackerrank.com/${username}`, rawData: { note: "no public API" } };
}

async function fetchAtCoder(username: string): Promise<CodingProfile> {
  return { platform: "atcoder", username, url: `https://atcoder.jp/users/${username}`, rawData: { note: "no public API" } };
}

export async function fetchCodingProfile(url: string): Promise<CodingProfile | null> {
  const detected = detectPlatform(url);
  if (!detected) return null;

  switch (detected.platform) {
    case "leetcode": return fetchLeetCode(detected.username);
    case "codechef": return fetchCodeChef(detected.username);
    case "codeforces": return fetchCodeforces(detected.username);
    case "geeksforgeeks": return fetchGFG(detected.username);
    case "hackerrank": return fetchHackerRank(detected.username);
    case "atcoder": return fetchAtCoder(detected.username);
    default: return { platform: "other", username: detected.username, url };
  }
}

function scoreVolume(profile: CodingProfile): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const total = profile.problemsSolved || 0;
  if (total >= 500) { score += 25; signals.push(`${total} problems solved`); }
  else if (total >= 200) { score += 18; signals.push(`${total} problems solved`); }
  else if (total >= 100) { score += 12; signals.push(`${total} problems solved`); }
  else if (total >= 50) { score += 7; signals.push(`${total} problems solved`); }
  else if (total >= 20) { score += 3; }

  return { score: Math.min(score, 25), signals };
}

function scoreDifficulty(profile: CodingProfile): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const hard = profile.hardSolved || 0;
  const medium = profile.mediumSolved || 0;
  const easy = profile.easySolved || 0;

  if (hard >= 50) { score += 20; signals.push(`${hard} hard`); }
  else if (hard >= 20) { score += 14; signals.push(`${hard} hard`); }
  else if (hard >= 10) { score += 8; signals.push(`${hard} hard`); }
  else if (hard >= 5) { score += 4; }

  if (medium >= 100) { score += 10; signals.push(`${medium} medium`); }
  else if (medium >= 50) { score += 7; }
  else if (medium >= 20) { score += 4; }

  if (easy >= 100) { score += 5; }
  else if (easy >= 50) { score += 3; }

  const total = easy + medium + hard;
  const ratio = total > 0 ? (hard + medium * 0.5) / total : 0;
  if (ratio > 0.4) signals.push("Strong hard/medium ratio");

  return { score: Math.min(score, 25), signals };
}

function scoreConsistency(profile: CodingProfile): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const contests = profile.contestCount || 0;
  if (contests >= 50) { score += 20; signals.push(`${contests} contests`); }
  else if (contests >= 20) { score += 12; signals.push(`${contests} contests`); }
  else if (contests >= 10) { score += 7; signals.push(`${contests} contests`); }
  else if (contests >= 5) { score += 3; }

  if (profile.lastActive) {
    const days = Math.floor((Date.now() - new Date(profile.lastActive).getTime()) / 86400000);
    if (days <= 7) { score += 8; signals.push("Active this week"); }
    else if (days <= 30) { score += 5; signals.push("Active this month"); }
    else if (days <= 90) { score += 2; }
  }

  return { score: Math.min(score, 25), signals };
}

function scoreCompetitiveness(profile: CodingProfile): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const rating = profile.rating || profile.maxRating || 0;
  if (rating >= 2000) { score += 25; signals.push(`${rating} rating (Expert+)`); }
  else if (rating >= 1600) { score += 18; signals.push(`${rating} rating (Specialist)`); }
  else if (rating >= 1400) { score += 12; signals.push(`${rating} rating (Pupil)`); }
  else if (rating >= 1200) { score += 6; signals.push(`${rating} rating`); }
  else if (rating > 0) { score += 3; }

  if (profile.rank && profile.rank.startsWith("#")) {
    const num = parseInt(profile.rank.slice(1), 10);
    if (!isNaN(num)) {
      if (num <= 1000) { score += 10; signals.push(`Top ${num} global`); }
      else if (num <= 10000) { score += 6; signals.push(`Top ${num} global`); }
      else if (num <= 50000) { score += 3; }
    }
  }

  return { score: Math.min(score, 25), signals };
}

export function scoreCodingProfile(profile: CodingProfile): PlatformScore {
  if (profile.rawData?.error) {
    return { profile, score: 0, breakdown: { volume: 0, difficulty: 0, consistency: 0, competitiveness: 0 }, signals: [`${profile.platform}: data unavailable`] };
  }
  const volume = scoreVolume(profile);
  const difficulty = scoreDifficulty(profile);
  const consistency = scoreConsistency(profile);
  const competitiveness = scoreCompetitiveness(profile);

  const total = volume.score + difficulty.score + consistency.score + competitiveness.score;
  const allSignals = [...volume.signals, ...difficulty.signals, ...consistency.signals, ...competitiveness.signals];

  return {
    profile,
    score: Math.min(total, 100),
    breakdown: {
      volume: volume.score,
      difficulty: difficulty.score,
      consistency: consistency.score,
      competitiveness: competitiveness.score,
    },
    signals: allSignals,
  };
}

export function aggregateCodingScore(scored: PlatformScore[]): { total: number; byPlatform: Record<string, number>; signals: string[] } {
  if (!scored.length) return { total: 0, byPlatform: {}, signals: ["No coding platform profiles linked"] };

  const byPlatform: Record<string, number> = {};
  const allSignals: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const s of scored) {
    byPlatform[s.profile.platform] = s.score;
    weightedSum += s.score;
    totalWeight += 1;
    allSignals.push(...s.signals);
  }

  return { total: Math.round(weightedSum / totalWeight), byPlatform, signals: allSignals };
}