"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { Opportunity } from "@/lib/mockData";
import { useOpportunities } from "@/hooks/useOpportunities";
import { AIServiceClient, AIServiceUnavailableError, ResumeAnalysisResult } from "@/lib/aiServiceClient";
import {
  Sparkles,
  CheckCircle,
  AlertCircle,
  FileText,
  MessageSquare,
  Award,
  Send,
  Loader2,
  LineChart,
  Zap,
  TrendingUp,
  UploadCloud,
  ArrowRight,
  X,
  RefreshCw,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Target,
  Link2,
  ExternalLink,
} from "lucide-react";
import { fetchPerformanceProfile, refreshPerformanceProfile } from "@/lib/performanceProfileClient";
import { bandLabel } from "@/lib/wallet/performanceProfile";
import { WALLET_CATEGORIES } from "@/lib/wallet/categories";
import { kindLabel } from "@/lib/profileLinks";
import type { PerformanceBand, PerformanceSnapshot } from "@/lib/types";
import { Button, Card, Chip, EmptyState, ErrorState, Select, Stat, Textarea } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

const BAND_STYLES: Record<
  PerformanceBand,
  { ring: string; text: string; tone: "success" | "gold" | "warning" | "neutral" }
> = {
  strong: { ring: "stroke-success", text: "text-success", tone: "success" },
  solid: { ring: "stroke-secondary", text: "text-secondary", tone: "gold" },
  developing: { ring: "stroke-warning", text: "text-warning", tone: "warning" },
  early: { ring: "stroke-border-strong", text: "text-foreground-muted", tone: "neutral" },
  empty: { ring: "stroke-border", text: "text-foreground-muted", tone: "neutral" },
};

function scoreTone(score: number, missing: boolean) {
  if (missing) return { bar: "bg-border", text: "text-foreground-subtle" };
  if (score >= 70) return { bar: "bg-success", text: "text-success" };
  if (score >= 45) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-danger", text: "text-danger" };
}

function ScoreRing({ score, band }: { score: number; band: PerformanceBand }) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const style = BAND_STYLES[band];
  const rounded = Math.round(score);

  return (
    <div
      className="relative h-[168px] w-[168px] shrink-0"
      role="img"
      aria-label={`Overall score ${rounded} out of 100`}
    >
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={radius} className="fill-none stroke-border" strokeWidth="12" />
        <motion.circle
          cx="80"
          cy="80"
          r={radius}
          className={`fill-none ${style.ring}`}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: EASE_OUT_EXPO }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display text-5xl leading-none ${style.text}`}>{rounded}</span>
        <span className="eyebrow mt-2">out of 100</span>
      </div>
    </div>
  );
}

function DimensionBar({
  label,
  score,
  weight,
  missing,
  docCount,
  evidence,
  notes,
}: {
  label: string;
  score: number;
  weight: number;
  missing: boolean;
  docCount: number;
  evidence: string[];
  notes: string[];
}) {
  const tone = scoreTone(score, missing);

  return (
    <Card className="h-full p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-base text-foreground">{label}</span>
        <span className="flex items-center gap-3">
          <span className="eyebrow">{Math.round(weight * 100)}% weight</span>
          <span className={`font-display text-lg ${tone.text}`}>{missing ? "—" : score}</span>
        </span>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
        role="img"
        aria-label={missing ? `${label}: no evidence yet` : `${label}: ${score} out of 100`}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${missing ? 0 : Math.min(100, score)}%` }}
          transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
          className={`h-full rounded-full ${tone.bar}`}
        />
      </div>

      <p className="mt-3 text-xs text-foreground-muted">
        {missing
          ? "No documents back this dimension yet — it is left out of your average."
          : `Based on ${docCount} document${docCount === 1 ? "" : "s"}.`}
      </p>

      {evidence.length > 0 && (
        <ul className="mt-4 space-y-2">
          {evidence.slice(0, 4).map((e) => (
            <li key={e} className="flex items-start gap-2 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {notes.slice(0, 2).map((n) => (
            <li key={n} className="flex items-start gap-2 text-sm text-foreground-muted">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Hoisted so the nav does not rebuild the array on every render. */
const TABS = [
  { id: "recommendations", label: "Opportunity Matcher", icon: Award },
  { id: "resume", label: "ATS Resume Scan", icon: FileText },
  { id: "chat", label: "Career Chatbot", icon: MessageSquare },
  { id: "analytics", label: "Performance Tracker", icon: LineChart },
] as const;

type TabId = (typeof TABS)[number]["id"];



/**
 * Match strength is expressed with three tokens, not three hardcoded hexes.
 * Previously each threshold pair (`bg-emerald-500/10 text-emerald-600 …`) was
 * retyped by hand, so the same "strong" state was a slightly different green on
 * every surface it appeared on.
 */
function matchTone(score: number) {
  if (score >= 80) {
    return {
      bar: "bg-success",
      text: "text-success",
      chip: "success" as const,
      panel: "bg-success-surface border-success/20",
    };
  }
  if (score >= 60) {
    return {
      bar: "bg-secondary",
      text: "text-secondary",
      chip: "gold" as const,
      panel: "bg-accent-gold-surface border-secondary/20",
    };
  }
  return {
    bar: "bg-warning",
    text: "text-warning",
    chip: "warning" as const,
    panel: "bg-warning-surface border-warning/20",
  };
}

export default function AIHub() {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "analytics" || tabParam === "performance") return "analytics";
    if (tabParam === "resume") return "resume";
    if (tabParam === "chat") return "chat";
    return "recommendations";
  });

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "analytics" || tabParam === "performance") {
      setActiveTab("analytics");
    } else if (tabParam === "resume") {
      setActiveTab("resume");
    } else if (tabParam === "chat") {
      setActiveTab("chat");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push("/auth/login");
    }
  }, [currentUser, authLoading, router]);

  if (authLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 spin text-secondary" />
        <span className="sr-only">Loading your AI workspace</span>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="flex-grow bg-background">
        <div className="shell py-16 lg:py-20">
          <Reveal>
            <span className="eyebrow text-secondary">AI Hub Workspace</span>
            <h1 className="mt-4 text-display-sm text-foreground">Intelligent Career Guidance</h1>
            <p className="mt-4 max-w-2xl text-base text-foreground-muted">
              Check opportunities, analyze your resume, and chat with our career assistant.
            </p>
            <div className="rule-accent mt-8" />
          </Reveal>

          <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[16rem_1fr] lg:gap-10">
            {/* Instrument rail. Sticky so it stays reachable while a long tab
                scrolls; `h-fit` on a grid child is not enough for that. */}
            <nav aria-label="AI instruments" className="lg:sticky lg:top-24 lg:h-fit">
              <span className="eyebrow mb-4 px-3">AI Instruments</span>
              <ul className="space-y-1">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <li key={tab.id}>
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab.id as TabId)}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-base ${
                          isActive
                            ? "bg-surface-ink text-background shadow-e2"
                            : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className={isActive ? "font-semibold" : "font-medium"}>{tab.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Tab panel. Keyed so the entrance animation replays on switch —
                without the key the motion runs once and every later tab
                appears instantly, which felt like a broken transition. */}
            <div className="min-w-0">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                {activeTab === "recommendations" && <RecommendationsTab />}
                {activeTab === "resume" && <ResumeTab />}
                {activeTab === "chat" && <ChatTab />}
                {activeTab === "analytics" && <AnalyticsTab />}
              </motion.div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ==========================================================================
   TAB 1: OPPORTUNITY RECOMMENDATIONS (Deep Multi-Signal Matcher)
   ========================================================================== */

interface MatchSignal {
  label: string;
  points: number;
  icon: string;
}

interface MatchResult {
  opportunity: Opportunity;
  score: number;
  signals: MatchSignal[];
}

function ScoreBar({ score }: { score: number }) {
  const tone = matchTone(score);
  return (
    <div
      className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border"
      role="img"
      aria-label={`Match score ${score} out of 100`}
    >
      <motion.div
        className={`h-full rounded-full ${tone.bar}`}
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

function RecommendationsTab() {
  const { profile } = useAuth();
  const { opportunities } = useOpportunities();
  const [loading, setLoading] = useState(false);
  const [recs, setRecs] = useState<MatchResult[]>([]);
  const [showCount, setShowCount] = useState(8);

  /** Build human-readable explanation of why score is high or low */
  const buildExplanation = (
    score: number,
    signals: MatchSignal[],
    opp: Opportunity
  ): { why: string; missing: string[] } => {
    const matched = signals.map((s) => s.label.split(":").pop()?.trim() || s.label);
    const missing: string[] = [];
    if (!profile?.skills?.length) missing.push("skills");
    if (!profile?.interests?.length) missing.push("interests");
    if (!profile?.location) missing.push("location");
    if (!profile?.education) missing.push("education level");

    let why = "";
    if (score >= 80) {
      why = `Strong match — your profile directly aligns with this opportunity.${matched.length ? ` Key matches: ${matched.slice(0, 3).join(", ")}.` : ""}`;
    } else if (score >= 60) {
      why = `Good match — several profile signals overlap with this opportunity${matched.length ? ` (${matched.slice(0, 2).join(", ")})` : ""}. Adding more profile data could push this higher.`;
    } else if (score >= 45) {
      why = `Partial match — some signals align${matched.length ? ` like ${matched[0]}` : ""}, but your profile doesn't yet strongly match the field "${opp.field}" or category "${opp.category}".`;
    } else {
      why = `Low match — this opportunity's field "${opp.field}" and category "${opp.category}" don't closely align with your current profile. It may still be worth a look if you're exploring new areas.`;
    }
    return { why, missing };
  };


  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

const runMatcher = () => {
    if (!profile || !opportunities.length) return;
    setLoading(true);

    // --- Normalized user profile ---
    const userSkills = (profile.skills || []).map((s) => s.toLowerCase().trim());
    const userInterests = (profile.interests || []).map((i) => i.toLowerCase().trim());
    const userCategory = (profile.category || "").toLowerCase().trim();
    const userLocation = (profile.location || "").toLowerCase().trim();
    const userEducation = (profile.education || "").toLowerCase().trim();
    const userBio = profile.bio || "";
    const userIncome = (profile.income || "").toLowerCase().trim();
    const bioTokens = tokenize(userBio);

    // --- Performance profile enrichment (if available) ---
    // The performance profile (from wallet documents) can provide additional skills/tech
    const perfSkills: string[] = []; // Could be populated from performance context if available
    const perfTechs: string[] = [];

    // Helper: word-boundary-aware contains check
    const containsWord = (haystack: string, needle: string): boolean => {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
    };

    const results: MatchResult[] = opportunities.map((opp) => {
      const signals: MatchSignal[] = [];
      let score = 0;

      const oppText = [opp.description, opp.eligibility, opp.field, opp.title]
        .join(" ")
        .toLowerCase();
      const oppTokens = tokenize(oppText);

      // Signal 1: Category exact match (+20)
      if (userCategory && opp.category.toLowerCase() === userCategory) {
        score += 20;
        signals.push({ label: `Category: ${opp.category}`, points: 20, icon: "🎯" });
      }

      // Signal 2: Skills match (+6 per skill, max +30) — word-boundary aware
      let skillPoints = 0;
      const matchedSkills: string[] = [];
      for (const skill of userSkills) {
        if (containsWord(oppText, skill) && skillPoints < 30) {
          skillPoints += 6;
          matchedSkills.push(skill);
        }
      }
      if (skillPoints > 0) {
        score += skillPoints;
        signals.push({
          label: `Skills: ${matchedSkills.slice(0, 3).join(", ")}${matchedSkills.length > 3 ? ` +${matchedSkills.length - 3}` : ""}`,
          points: skillPoints,
          icon: "⚡",
        });
      }

      // Signal 3: Interests / field match (+5 per match, max +20) — word-boundary aware
      let intPoints = 0;
      const matchedInterests: string[] = [];
      for (const interest of userInterests) {
        if (
          (containsWord(opp.field, interest) ||
            containsWord(opp.description, interest)) &&
          intPoints < 20
        ) {
          intPoints += 5;
          matchedInterests.push(interest);
        }
      }
      if (intPoints > 0) {
        score += intPoints;
        signals.push({
          label: `Interests: ${matchedInterests.slice(0, 2).join(", ")}`,
          points: intPoints,
          icon: "💡",
        });
      }

      // Signal 4: Location / country match (+10) — exact or prefix match
      if (userLocation && opp.country.toLowerCase().includes(userLocation)) {
        score += 10;
        signals.push({ label: `Country: ${opp.country}`, points: 10, icon: "📍" });
      }

      // Signal 5: Education level match (+8)
      const eduKeywords = ["bachelor", "master", "phd", "diploma", "undergraduate", "postgraduate", "mba"];
      let eduMatched = "";
      for (const kw of eduKeywords) {
        if (userEducation.includes(kw) && opp.eligibility.toLowerCase().includes(kw)) {
          eduMatched = kw;
          break;
        }
      }
      if (!eduMatched && opp.degreeLevel && userEducation.includes(opp.degreeLevel.toLowerCase())) {
        eduMatched = opp.degreeLevel;
      }
      if (eduMatched) {
        score += 8;
        signals.push({ label: `Education: ${eduMatched}`, points: 8, icon: "🎓" });
      }

      // Signal 6: Income / financial need match (+8)
      const isLowIncome =
        userIncome.includes("low") ||
        userIncome.includes("below") ||
        userIncome.includes("bpl") ||
        userIncome.includes("<");
      if (isLowIncome && opp.incomeLimit != null) {
        score += 8;
        signals.push({ label: "Income criteria eligible", points: 8, icon: "💰" });
      }

      // Signal 7: Bio keyword resonance (+3 per token, max +10)
      let bioPoints = 0;
      const matchedBio: string[] = [];
      for (const token of bioTokens) {
        if (token.length > 3 && oppTokens.includes(token) && bioPoints < 10) {
          bioPoints += 3;
          matchedBio.push(token);
        }
      }
      if (bioPoints > 0) {
        score += bioPoints;
        signals.push({
          label: `Bio keywords: ${matchedBio.slice(0, 2).join(", ")}`,
          points: bioPoints,
          icon: "📝",
        });
      }

      // Signal 8: Field token overlap vs skills+interests (+4 each, max +12)
      const fieldTokens = tokenize(opp.field);
      const allUserTokens = [...userSkills, ...userInterests];
      const fieldOverlap = fieldTokens.filter((ft) =>
        allUserTokens.some((ut) => ut.includes(ft) || ft.includes(ut))
      );
      if (fieldOverlap.length > 0 && intPoints === 0) {
        const fPoints = Math.min(fieldOverlap.length * 4, 12);
        score += fPoints;
        signals.push({ label: `Field overlap: ${opp.field}`, points: fPoints, icon: "🔗" });
      }

      return {
        opportunity: opp,
        score: Math.min(Math.round(score), 100),
        signals,
      };
    });

    results.sort((a, b) => b.score - a.score);
    setRecs(results);
    setLoading(false);
  };

  useEffect(() => {
    runMatcher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, opportunities]);


  const displayed = recs.slice(0, showCount);
  const hasProfile =
    profile &&
    ((profile.skills?.length ?? 0) > 0 ||
      (profile.interests?.length ?? 0) > 0 ||
      !!profile.category ||
      !!profile.location);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">Instrument 01</span>
          <h2 className="mt-2 font-display text-2xl text-foreground">Opportunity Matcher</h2>
          <p className="mt-2 max-w-xl text-sm text-foreground-muted">
            Ranked highest to lowest match — based on your skills, interests, location,
            education, income &amp; bio.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={runMatcher}
          disabled={loading}
          leadingIcon={
            loading ? (
              <Loader2 className="h-3.5 w-3.5 spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )
          }
        >
          Rematch
        </Button>
      </div>

      {/* Profile completeness nudge */}
      {!hasProfile && !loading && (
        <Reveal>
          <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning-surface p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-semibold text-warning">
                Complete your profile for better matches
              </p>
              <p className="mt-1 text-sm text-foreground-muted">
                Add skills, interests, location, and education in profile settings to unlock
                deep matching.
              </p>
            </div>
          </div>
        </Reveal>
      )}

      {/* Results */}
      <div className="space-y-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="h-6 w-6 spin text-secondary" />
            <p className="text-sm text-foreground-muted">
              Scanning {opportunities.length} opportunities…
            </p>
          </div>
        ) : displayed.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" />}
            title="No opportunities found"
            description="Check back once opportunities are available in the database."
          />
        ) : (
          <>
            <p className="text-xs text-foreground-subtle">
              Showing <span className="font-semibold text-foreground">{displayed.length}</span>{" "}
              of <span className="font-semibold text-foreground">{recs.length}</span>{" "}
              opportunities — best matches first
            </p>
            <Stagger as="ul" className="grid grid-cols-1 gap-4">
              {displayed.map(({ opportunity, score, signals }) => {
                const tone = matchTone(score);
                const { why, missing } = buildExplanation(score, signals, opportunity);

                return (
                  <StaggerItem as="li" key={opportunity.id}>
                    <Card className="p-5 sm:p-6">
                      {/* Top Row */}
                      <div className="flex items-start justify-between gap-5">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Chip tone="gold">{opportunity.category}</Chip>
                            <span className="text-2xs text-foreground-subtle">{opportunity.field}</span>
                          </div>
                          <h3 className="font-display text-lg leading-snug text-foreground">
                            <Link
                              href={`/opportunity/${opportunity.id}`}
                              className="transition-colors duration-base hover:text-secondary"
                            >
                              {opportunity.title}
                            </Link>
                          </h3>
                          <p className="mt-1 text-sm text-foreground-muted">
                            {opportunity.organization} · {opportunity.country}
                          </p>
                        </div>

                        {/* Score */}
                        <div className="w-24 shrink-0 text-right">
                          <span
                            className={`block font-display text-3xl leading-none ${tone.text}`}
                          >
                            {score}
                          </span>
                          <span className="eyebrow mt-1">Match</span>
                          <ScoreBar score={score} />
                        </div>
                      </div>

                      {/* Signal Chips */}
                      {signals.length > 0 && (
                        <ul className="mt-5 flex flex-wrap gap-1.5">
                          {signals.map((sig, idx) => (
                            <li key={idx}>
                              <Chip>
                                <span>{sig.icon}</span>
                                {sig.label}
                                <span className="font-semibold text-secondary">+{sig.points}</span>
                              </Chip>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Explanation */}
                      <div className={`mt-5 rounded-md border p-4 ${tone.panel}`}>
                        <p className="text-sm leading-relaxed text-foreground">{why}</p>
                        {missing.length > 0 && score < 70 && (
                          <p className="mt-2 text-sm text-foreground-muted">
                            To improve this score, add your{" "}
                            <span className="font-medium text-foreground">
                              {missing.slice(0, 2).join(" & ")}
                            </span>{" "}
                            to your profile.
                          </p>
                        )}
                      </div>

                      {/* Deadline + CTA */}
                      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
                        <span className="text-xs text-foreground-subtle">
                          Deadline{" "}
                          <span className="font-medium text-foreground">
                            {opportunity.deadline
                              ? new Date(opportunity.deadline).toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })
                              : "Open"}
                          </span>
                        </span>
                        <Link
                          href={`/opportunity/${opportunity.id}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary transition-colors duration-base hover:text-secondary-hover"
                        >
                          View Details
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </Card>
                  </StaggerItem>
                );
              })}
            </Stagger>

            {recs.length > showCount && (
              <Button
                variant="quiet"
                block
                onClick={() => setShowCount((c) => c + 8)}
                className="border border-border"
              >
                Load {Math.min(8, recs.length - showCount)} more opportunities
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   TAB 3: RESUME ANALYZER (Scan)
   ========================================================================== */
function ResumeTab() {
  const { currentUser } = useAuth();
  const [resumeText, setResumeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResumeAnalysisResult | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [analysisError, setAnalysisError] = useState("");

  const fetchHistory = async () => {
    if (!currentUser) return;
    try {
      const q = query(
        collection(db, "resume_analyses"),
        where("uid", "==", currentUser.uid),
        orderBy("timestamp", "desc"),
        limit(3)
      );
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setHistory(list);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [currentUser]);

  // Extracts plain text from an uploaded PDF/DOCX/TXT resume file and drops
  // it into the same `resumeText` state the paste-box uses. Any failure
  // here is caught and surfaced as a friendly message — it never breaks the
  // rest of the tab, and the user can always fall back to pasting text
  // manually below.
  const handleFileUpload = async (file: File) => {
    setExtractError("");
    setExtracting(true);
    setUploadedFileName(file.name);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let text = "";

      if (ext === "txt") {
        text = await file.text();
      } else if (ext === "pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pageTexts.push(content.items.map((item: any) => item.str).join(" "));
        }
        text = pageTexts.join("\n\n");
      } else if (ext === "docx") {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const res = await mammoth.extractRawText({ arrayBuffer });
        text = res.value;
      } else {
        throw new Error("Unsupported file type. Please upload a .pdf, .docx, or .txt file.");
      }

      if (!text.trim()) {
        throw new Error(
          "Couldn't find readable text in this file (it may be a scanned image). Please paste your resume text manually below."
        );
      }

      setResumeText(text.trim());
    } catch (err: any) {
      console.error("Resume file extraction failed:", err);
      setExtractError(
        err?.message || "Failed to read this file. Please paste your resume text manually below."
      );
    } finally {
      setExtracting(false);
    }
  };

  const analyzeResume = async () => {
    if (!resumeText.trim()) return;
    setLoading(true);
    setAnalysisError("");
    try {
      const analysis = await AIServiceClient.analyzeResume(resumeText);
      setResult(analysis);

      if (currentUser) {
        await addDoc(collection(db, "resume_analyses"), {
          uid: currentUser.uid,
          atsScore: analysis.atsScore,
          strengths: analysis.strengths,
          weaknesses: analysis.weaknesses,
          missingSkills: analysis.missingSkills,
          formattingFeedback: analysis.formattingFeedback,
          improvementSuggestions: analysis.improvementSuggestions,
          timestamp: new Date().toISOString(),
        });
        await fetchHistory();
      }
    } catch (error) {
      console.error(error);
      setResult(null);
      setAnalysisError(
        error instanceof AIServiceUnavailableError
          ? error.message
          : "Could not analyze your resume right now. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <span className="eyebrow">Instrument 02</span>
        <h2 className="mt-2 font-display text-2xl text-foreground">AI ATS Resume Scanner</h2>
        <p className="mt-2 max-w-xl text-sm text-foreground-muted">
          Paste your resume text to get formatting advice, ATS scoring, and skill addition
          templates from Gemini.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <span className="eyebrow">Upload resume file</span>
          <label
            className={`flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed px-5 py-8 text-sm transition-colors duration-base ${
              extracting
                ? "border-border bg-surface-sunken text-foreground-subtle"
                : "border-border-strong bg-surface-raised text-foreground-muted hover:border-secondary hover:bg-accent-gold-surface/50 hover:text-foreground"
            }`}
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 spin text-secondary" /> Reading {uploadedFileName}…
              </>
            ) : uploadedFileName ? (
              <>
                <FileText className="h-4 w-4 text-secondary" /> {uploadedFileName}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setUploadedFileName("");
                    setResumeText("");
                    setExtractError("");
                  }}
                  className="ml-1 rounded-sm p-1 transition-colors duration-fast hover:bg-surface hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="sr-only">Remove uploaded file</span>
                </button>
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" /> Click to upload a .pdf, .docx, or .txt resume
              </>
            )}
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              className="sr-only"
              disabled={extracting}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = "";
              }}
            />
          </label>
          {extractError && <ErrorState description={extractError} className="py-4 text-left" />}
        </div>

        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <span className="eyebrow">or paste manually</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Textarea
          label="Paste resume plain text"
          rows={7}
          placeholder="Paste raw text of your resume here to analyze structure, skills, and formats…"
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
        />

        <Button
          block
          onClick={analyzeResume}
          disabled={loading || !resumeText.trim()}
          leadingIcon={loading ? <Loader2 className="h-4 w-4 spin" /> : null}
        >
          {loading ? "Scanning…" : "Run AI Scan & ATS Grade"}
        </Button>
      </div>

      {analysisError && <ErrorState description={analysisError} />}

      {result && (
        <Reveal className="space-y-6 border-t border-border pt-8">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised px-5 py-4">
            <div>
              <span className="eyebrow">ATS Score Estimation</span>
              <span className="mt-2 block font-display text-4xl leading-none text-foreground">
                {result.atsScore}
                <span className="text-lg text-foreground-subtle">/100</span>
              </span>
            </div>
            {result.atsScore >= 75 ? (
              <Chip tone="success">Ready to Apply</Chip>
            ) : (
              <Chip tone="warning">Needs Revision</Chip>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card tone="raised" className="p-5">
              <span className="eyebrow">Strengths identified</span>
              <ul className="mt-3 space-y-2">
                {result.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground">
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {s}
                  </li>
                ))}
              </ul>
            </Card>

            <Card tone="raised" className="p-5">
              <span className="eyebrow">Areas of weakness</span>
              <ul className="mt-3 space-y-2">
                {result.weaknesses.map((w, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> {w}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card tone="raised" className="p-5">
            <span className="eyebrow">Missing skills from industry</span>
            <ul className="mt-3 flex flex-wrap gap-2">
              {result.missingSkills.map((sk, i) => (
                <li key={i}>
                  <Chip tone="gold">{sk}</Chip>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-3">
            <span className="eyebrow">Improvement suggestions</span>
            <p className="text-sm leading-relaxed text-foreground">{result.formattingFeedback}</p>
            <ul className="space-y-2 pt-1">
              {result.improvementSuggestions.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-foreground-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      )}

      {history.length > 0 && (
        <div className="border-t border-border pt-8">
          <span className="eyebrow mb-4">Recent analysis history</span>
          <ul className="space-y-2">
            {history.map((h, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 rounded-md bg-surface-raised px-4 py-3"
              >
                <span className="font-display text-lg text-foreground">{h.atsScore}</span>
                <span className="text-xs text-foreground-subtle">
                  {new Date(h.timestamp).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   TAB 4: CAREER CHATBOT
   ========================================================================== */
function ChatTab() {
  const { currentUser, profile } = useAuth();
  const [messages, setMessages] = useState<{ role: "user" | "model"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState("");

  const fetchChatHistory = async () => {
    if (!currentUser) return;
    try {
      const snap = await getDoc(doc(db, "chat_history", currentUser.uid));
      if (snap.exists()) {
        setMessages(snap.data().messages || []);
      } else {
        setMessages([
          {
            role: "model",
            text: "Hello! I am your AI career advisor at NEXORA. How can I help you find target opportunities, optimize your resume, or prepare for applications today?",
          },
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchChatHistory();
  }, [currentUser]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    const newMessages = [...messages, { role: "user" as const, text: userMsg }];
    setMessages(newMessages);
    setLoading(true);
    setChatError("");

    try {
      const chatResponse = await AIServiceClient.getChatbotResponse(
        userMsg,
        newMessages,
        profile || {}
      );

      const finalMessages = [...newMessages, { role: "model" as const, text: chatResponse }];
      setMessages(finalMessages);

      if (currentUser) {
        await setDoc(doc(db, "chat_history", currentUser.uid), { messages: finalMessages });
      }
    } catch (err) {
      console.error(err);
      // Show the failure in-thread instead of replacing it with a canned reply,
      // which used to look like a genuine answer from the advisor.
      setChatError(
        err instanceof AIServiceUnavailableError
          ? err.message
          : "The advisor is unavailable right now. Please try again."
      );
      setMessages(newMessages);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[36rem] flex-col space-y-6">
      <div>
        <span className="eyebrow">Instrument 03</span>
        <h2 className="mt-2 font-display text-2xl text-foreground">AI Career Chatbot</h2>
        <p className="mt-2 max-w-xl text-sm text-foreground-muted">
          Chat with a context-aware assistant loaded with your profile settings. Unrelated
          questions are filtered.
        </p>
      </div>

      <div className="card-inset flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-surface-ink text-background"
                    : "border border-border bg-surface text-foreground"
                }`}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground-muted">
                <Loader2 className="h-3.5 w-3.5 spin text-secondary" />
                <span>NEXORA Advisor is formulating advice…</span>
              </div>
            </div>
          )}
          {chatError && <ErrorState description={chatError} className="items-start py-4 text-left" />}
        </div>

        <form onSubmit={sendMessage} className="flex gap-2 border-t border-border p-4">
          <input
            type="text"
            aria-label="Ask the career advisor"
            placeholder="Ask anything about scholarships, resumes, careers…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="input flex-1"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={loading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ==========================================================================
   TAB 4: ANALYTICS & CONFIDENCE TRACKER
   ========================================================================== */
function AnalyticsTab() {
  const { currentUser, profile: authProfile } = useAuth();
  const [profile, setProfile] = useState<PerformanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [atsScore, setAtsScore] = useState<number | null>(null);

  const computeProfileCompletion = (): number => {
    if (!authProfile) return 0;
    const fields: (keyof typeof authProfile)[] = [
      "bio",
      "education",
      "skills",
      "interests",
      "location",
      "income",
    ];
    const filled = fields.filter((f) => {
      const val = authProfile[f];
      if (Array.isArray(val)) return val.length > 0;
      return typeof val === "string" && val.trim().length > 0;
    }).length;
    return Math.round((filled / fields.length) * 100);
  };

  const loadData = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      // 1. Fetch latest ATS score
      const resumeSnap = await getDocs(
        query(collection(db, "resume_analyses"), where("uid", "==", currentUser.uid), limit(5))
      );
      let latestATS: number | null = null;
      resumeSnap.forEach((d) => {
        latestATS = d.data().atsScore;
      });
      setAtsScore(latestATS);

      // 2. Fetch or compute Performance Snapshot
      const cached = await fetchPerformanceProfile(currentUser.uid);
      let currentPerf = cached;

      if (cached) {
        setProfile(cached);
        // Silently refresh in background — errors are intentionally swallowed here
        refreshPerformanceProfile(currentUser.uid, { refreshNarrative: false })
          .then((fresh) => { if (fresh) setProfile(fresh); })
          .catch((e) => { console.warn("[performance] background refresh failed:", e?.message); });
      } else {
        const fresh = await refreshPerformanceProfile(currentUser.uid, { refreshNarrative: true }).catch((e) => {
          console.warn("[performance] initial compute failed:", e?.message);
          return null;
        });
        if (fresh) {
          currentPerf = fresh;
          setProfile(fresh);
        }
      }

      // 3. Optional AI progress summary
      const currentStats = {
        profileCompletion: computeProfileCompletion(),
        resumeScanScore: latestATS ?? 0,
        performanceScore: currentPerf?.overall ?? 0,
      };

      setSummaryError("");
      try {
        const progressSummary = await AIServiceClient.trackConfidence(currentStats);
        setSummary(progressSummary);
      } catch (e) {
        setSummary("");
        setSummaryError(
          e instanceof AIServiceUnavailableError
            ? e.message
            : "Could not generate a progress summary right now."
        );
      }
    } catch (e) {
      console.error("Error loading performance tracker data:", e);
    } finally {
      setLoading(false);
    }
  }, [currentUser, authProfile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    if (!currentUser || refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const data = await refreshPerformanceProfile(currentUser.uid, { refreshNarrative: true, force: true });
      if (data) {
        setProfile(data);
      } else {
        setRefreshError("Could not recalculate — please try again in a moment.");
      }
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("429") || msg.toLowerCase().includes("rate") || msg.toLowerCase().includes("too many")) {
        setRefreshError("You've recalculated recently. Please wait a minute before trying again.");
      } else {
        setRefreshError(msg || "Recalculation failed. Please try again.");
      }
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
      </div>
    );
  }

  const band = profile?.band || "empty";
  const style = BAND_STYLES[band];

  const summaryStats = [
    { label: "Profile Integrity", value: `${computeProfileCompletion()}%` },
    { label: "Latest ATS Score", value: atsScore !== null ? `${atsScore}/100` : "—" },
    { label: "Documents", value: profile?.docCount ?? 0 },
    { label: "Evidence Coverage", value: `${profile?.coverage ?? 0}%` },
  ];

  return (
    <div className="space-y-10">
      <Reveal>
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <span className="eyebrow text-secondary">Instrument 04 · Readiness</span>
            <h2 className="mt-3 text-display-sm text-foreground">AI Performance Tracker</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-muted text-pretty">
              Every score here is scientifically calculated from your verified wallet documents — marksheets,
              certificates, awards, and GitHub/coding links. Upload documents or refresh to evaluate your readiness.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/dashboard/wallet" className="btn btn-sm btn-secondary">
              <Wallet className="h-3.5 w-3.5" /> Wallet
            </Link>
            <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Recalculate
            </Button>
          </div>
        </div>
        {refreshError && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{refreshError}</span>
          </div>
        )}
      </Reveal>

      {/* Main Score & Metrics */}
      <Reveal delay={0.05}>
        <Card className="flex flex-col items-center gap-8 p-8 md:flex-row">
          <ScoreRing score={profile?.overall || 0} band={band} />

          <div className="w-full flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={style.tone}>{bandLabel(band)}</Chip>
              {profile?.studentLevel && (
                <Chip tone="gold" icon={<Award className="h-3.5 w-3.5 text-secondary" />}>
                  {profile.studentLevel}
                </Chip>
              )}
              {profile && profile.potential > profile.overall && (
                <Chip tone="neutral" icon={<TrendingUp className="h-3 w-3" />}>
                  Potential {Math.round(profile.potential)}/100
                </Chip>
              )}
            </div>

            {profile?.studentLevelDescription && (
              <div className="rounded-md border border-secondary/20 bg-accent-gold-surface p-3 text-xs leading-relaxed text-secondary-contrast">
                <span className="font-semibold text-secondary">AI Caliber Verdict: </span>
                {profile.studentLevelDescription}
              </div>
            )}

            <p className="text-base leading-relaxed text-foreground text-pretty">
              {profile?.narrative || "No narrative generated yet. Upload documents and recalculate your profile."}
            </p>

            <Stagger gap={0.05} className="grid grid-cols-2 gap-3 pt-1 md:grid-cols-4">
              {summaryStats.map((s) => (
                <StaggerItem key={s.label}>
                  <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                    <span className="eyebrow block">{s.label}</span>
                    <span className="mt-1 block font-display text-sm text-foreground">{s.value}</span>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </Card>
      </Reveal>

      {/* Monthly AI Progress Digest */}
      <Card tone="raised" className="flex flex-col items-start gap-5 p-6 md:flex-row">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-secondary/25 bg-accent-gold-surface text-secondary">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="eyebrow">Monthly AI Progress Summary</span>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">
            {summary || "Upload more credentials to unlock personalized AI growth recommendations."}
          </p>
          {summaryError && <ErrorState description={summaryError} className="mt-4 py-3 text-left" />}
        </div>
      </Card>

      {/* Empty State */}
      {(!profile || profile.docCount === 0) && (
        <Reveal>
          <Card tone="inset" className="border-dashed p-10 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-border bg-surface text-secondary">
              <Sparkles className="h-5 w-5" />
            </span>
            <h3 className="mt-5 font-display text-xl text-foreground">Nothing to score yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-foreground-muted text-pretty">
              Upload your resume, marksheets, certificates, awards and project reports to the Opportunity Wallet. Each file
              is analyzed by AI, filed into the right category, and turned into evidence for your score.
            </p>
            <Button as="a" href="/dashboard/wallet" className="mt-6">
              <Wallet className="h-4 w-4" /> Open wallet
            </Button>
          </Card>
        </Reveal>
      )}

      {/* Dimensions Breakdown */}
      {profile && profile.docCount > 0 && (
        <>
          <Reveal>
            <div>
              <h3 className="flex items-center gap-2 font-display text-lg text-foreground">
                <Target className="h-5 w-5 text-secondary" /> Readiness Dimensions Breakdown
              </h3>
              <p className="mt-2 text-xs text-foreground-muted">
                Dimensions with no documents are excluded from the average instead of pulling down your score.
              </p>
            </div>
          </Reveal>

          <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {profile.dimensions.map((d) => (
              <StaggerItem key={d.key}>
                <DimensionBar
                  label={d.label}
                  score={d.score}
                  weight={d.weight}
                  missing={d.missing}
                  docCount={d.docCount}
                  evidence={d.evidence}
                  notes={d.notes}
                />
              </StaggerItem>
            ))}
          </Stagger>

          {/* Strengths, Gaps, Next Steps */}
          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StaggerItem>
              <Card className="h-full p-5">
                <h4 className="eyebrow flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Proven strengths
                </h4>
                <ul className="mt-4 space-y-2.5">
                  {profile.strengths.length ? (
                    profile.strengths.map((s) => (
                      <li key={s} className="text-sm leading-relaxed text-foreground">{s}</li>
                    ))
                  ) : (
                    <li className="text-sm text-foreground-muted">No dimension has crossed 60 yet.</li>
                  )}
                </ul>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="h-full p-5">
                <h4 className="eyebrow flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-4 w-4" /> What is holding you back
                </h4>
                <ul className="mt-4 space-y-2.5">
                  {profile.gaps.length ? (
                    profile.gaps.map((g) => (
                      <li key={g} className="text-sm leading-relaxed text-foreground">{g}</li>
                    ))
                  ) : (
                    <li className="text-sm text-foreground-muted">Nothing outstanding.</li>
                  )}
                </ul>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="h-full p-5">
                <h4 className="eyebrow flex items-center gap-1.5 text-secondary">
                  <TrendingUp className="h-4 w-4" /> Highest-impact next steps
                </h4>
                <ol className="mt-4 space-y-2.5">
                  {profile.nextSteps.length ? (
                    profile.nextSteps.map((s, i) => (
                      <li key={s} className="flex gap-3 text-sm leading-relaxed text-foreground">
                        <span className="font-display text-secondary">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-foreground">Your profile is complete. Keep it fresh.</li>
                  )}
                </ol>
                <Link
                  href="/dashboard/wallet"
                  className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-secondary transition-colors duration-base hover:text-secondary-hover"
                >
                  Upload documents <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Card>
            </StaggerItem>
          </Stagger>

          {/* Public Profiles */}
          {profile.profileLinks && profile.profileLinks.length > 0 && (
            <Reveal>
              <Card className="p-5">
                <h4 className="eyebrow flex items-center gap-1.5">
                  <Link2 className="h-4 w-4" /> Connected public profiles
                </h4>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {profile.profileLinks.map((l) => (
                    <li key={l.id}>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chip chip-gold transition-colors duration-base hover:opacity-80"
                      >
                        {l.label || kindLabel(l.kind)}
                        <ExternalLink className="h-3 w-3 opacity-70" />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-foreground-muted">
                  Connected profiles count as verified evidence toward Application Readiness. Manage them in your{" "}
                  <Link
                    href="/dashboard/wallet"
                    className="font-medium text-secondary transition-colors duration-base hover:text-secondary-hover"
                  >
                    wallet
                  </Link>
                  .
                </p>
              </Card>
            </Reveal>
          )}

          {/* Top Technologies & Skills */}
          {(profile.topTechnologies?.length || profile.topSkills?.length) && (
            <Reveal>
              <Card className="p-5">
                <h4 className="eyebrow flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" /> Verified tech stack &amp; skills
                </h4>
                <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
                  {profile.topTechnologies?.length ? (
                    <div>
                      <p className="eyebrow mb-2.5">Technologies</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {profile.topTechnologies.map((t) => (
                          <li key={t}>
                            <Chip tone="gold">{t}</Chip>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {profile.topSkills?.length ? (
                    <div>
                      <p className="eyebrow mb-2.5">Skills</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {profile.topSkills.map((s) => (
                          <li key={s}>
                            <Chip tone="success">{s}</Chip>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </Card>
            </Reveal>
          )}

          {/* Skill gaps */}
          {profile.skillGaps?.length && (
            <Reveal>
              <Card className="border-warning/25 bg-warning-surface p-5">
                <h4 className="eyebrow flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-4 w-4" /> Skill gaps to address
                </h4>
                <ul className="mt-4 space-y-2">
                  {profile.skillGaps.map((g) => (
                    <li key={g} className="flex gap-2.5 text-sm text-foreground">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warning" />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          )}

          {/* Preparation focus */}
          {profile.prepFocus?.length && (
            <Reveal>
              <Card className="p-5">
                <h4 className="eyebrow flex items-center gap-1.5 text-secondary">
                  <Target className="h-4 w-4" /> Preparation focus
                </h4>
                <ol className="mt-4 space-y-2">
                  {profile.prepFocus.map((p, i) => (
                    <li key={p} className="flex gap-3 text-sm text-foreground">
                      <span className="font-display text-secondary">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </Reveal>
          )}

          {/* Evidence distribution */}
          <Reveal>
            <Card className="p-5">
              <h4 className="eyebrow">Where your evidence sits</h4>
              <ul className="mt-4 flex flex-wrap gap-2">
                {WALLET_CATEGORIES.map((c) => {
                  const count = profile.categoryCounts[c] || 0;
                  return (
                    <li key={c}>
                      <Chip tone={count > 0 ? "gold" : "neutral"}>
                        {c}: {count}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </Reveal>
        </>
      )}
    </div>
  );
}
