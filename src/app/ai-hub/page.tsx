"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { useOpportunities } from "@/hooks/useOpportunities";
import { authedFetch } from "@/lib/apiClient";
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
  TrendingUp,
  UploadCloud,
  ArrowRight,
  X,
  Bookmark,
  FolderGit2,
  Link2,
  ExternalLink,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Download,
} from "lucide-react";
import type { WalletDocument, ProfileLink } from "@/lib/types";
import { subscribeProfileLinks } from "@/lib/profileLinksClient";
import { Button, Card, Chip, EmptyState, ErrorState, Textarea } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import MarkdownText from "@/components/ai/MarkdownText";


const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

/* ==========================================================================
   Rich resume-audit shape. Mirrors the server's AuditResult so the full
   breakdown the analyzer produces can be rendered (and stored) verbatim.
   ========================================================================== */

interface RichBreakdown {
  impactAndMetrics: number;
  skillsRelevance: number;
  actionVerbs: number;
  formattingAndClarity: number;
  experienceDepth: number;
}

interface RichContactInfo {
  complete: boolean;
  present: { label: string; value: string }[];
  missing: string[];
  suggestion: string;
}

interface RichQuantifiedImpact {
  detected: number;
  bulletsWithoutMetrics: string[];
  suggestion: string;
}

interface RichSectionCheck {
  name: string;
  present: boolean;
}

interface RichJobMatch {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  summary: string;
}

interface RichAudit {
  atsScore: number;
  verdict?: string;
  breakdown: RichBreakdown;
  executiveSummary: string;
  strengths: string[];
  criticalNegatives: string[];
  atsKeywordsFound: string[];
  missingRecommendedKeywords: string[];
  bulletImprovements: { original: string; improved: string }[];
  actionPlan: string[];
  contactInfo?: RichContactInfo;
  quantifiedImpact?: RichQuantifiedImpact;
  sections?: RichSectionCheck[];
  talentGaps?: string[];
  interviewQuestions?: string[];
  jobMatch?: RichJobMatch;
  readabilityScore?: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** Coerce whatever the server sent into a render-safe RichAudit. */
function richAudit(raw: unknown): RichAudit {
  const a = (raw ?? {}) as Record<string, unknown>;
  const b = (a.breakdown ?? {}) as Record<string, unknown>;
  const bullets = Array.isArray(a.bulletImprovements)
    ? (a.bulletImprovements as unknown[]).filter(
        (x): x is { original: string; improved: string } =>
          !!x && typeof (x as { original?: unknown }).original === "string" &&
          typeof (x as { improved?: unknown }).improved === "string"
      )
    : [];
  const contactInfo = a.contactInfo as RichContactInfo | undefined;
  const quantifiedImpact = a.quantifiedImpact as RichQuantifiedImpact | undefined;
  const sections = Array.isArray(a.sections)
    ? (a.sections as unknown[]).filter(
        (s): s is RichSectionCheck =>
          !!s && typeof (s as { name?: unknown }).name === "string" && typeof (s as { present?: unknown }).present === "boolean"
      )
    : [];
  const jobMatch = a.jobMatch as RichJobMatch | undefined;
  return {
    atsScore: num(a.atsScore),
    verdict: typeof a.verdict === "string" ? a.verdict : undefined,
    breakdown: {
      impactAndMetrics: num(b.impactAndMetrics),
      skillsRelevance: num(b.skillsRelevance),
      actionVerbs: num(b.actionVerbs),
      formattingAndClarity: num(b.formattingAndClarity),
      experienceDepth: num(b.experienceDepth),
    },
    executiveSummary: typeof a.executiveSummary === "string" ? a.executiveSummary : "",
    strengths: strList(a.strengths),
    criticalNegatives: strList(a.criticalNegatives),
    atsKeywordsFound: strList(a.atsKeywordsFound),
    missingRecommendedKeywords: strList(a.missingRecommendedKeywords),
    bulletImprovements: bullets,
    actionPlan: strList(a.actionPlan),
    ...(contactInfo && typeof contactInfo === "object" ? { contactInfo } : {}),
    ...(quantifiedImpact && typeof quantifiedImpact === "object" ? { quantifiedImpact } : {}),
    ...(sections.length > 0 ? { sections } : {}),
    ...(Array.isArray(a.talentGaps) ? { talentGaps: strList(a.talentGaps) } : {}),
    ...(Array.isArray(a.interviewQuestions) ? { interviewQuestions: strList(a.interviewQuestions) } : {}),
    ...(jobMatch && typeof jobMatch === "object" ? { jobMatch } : {}),
    ...(typeof a.readabilityScore !== "undefined" ? { readabilityScore: num(a.readabilityScore) } : {}),
  };
}

function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const BREAKDOWN_LABELS: { key: keyof RichBreakdown; label: string }[] = [
  { key: "impactAndMetrics", label: "Impact & Metrics" },
  { key: "skillsRelevance", label: "Skills Relevance" },
  { key: "actionVerbs", label: "Action Verbs" },
  { key: "formattingAndClarity", label: "Formatting & Clarity" },
  { key: "experienceDepth", label: "Experience Depth" },
];





/** Hoisted so the nav does not rebuild the array on every render. */
const TABS = [
  { id: "recommendations", label: "Opportunity Matcher", icon: Award },
  { id: "resume", label: "ATS Resume Scan", icon: FileText },
  { id: "chat", label: "Career Chatbot", icon: MessageSquare },
] as const;

type TabId = (typeof TABS)[number]["id"];





export default function AIHub() {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "resume") return "resume";
    if (tabParam === "chat") return "chat";
    return "recommendations";
  });

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "resume") {
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
   TAB 1: OPPORTUNITY MATCHER
   ========================================================================== */

function RecommendationsTab() {
  const { currentUser, profile } = useAuth();
  const { opportunities } = useOpportunities();
  const [showCount, setShowCount] = useState(8);
  const [walletDocs, setWalletDocs] = useState<WalletDocument[]>([]);
  const [profileLinks, setProfileLinks] = useState<ProfileLink[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<"all" | "saved">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 1. Fetch wallet documents (PDFs, projects, certificates, resume texts)
  useEffect(() => {
    if (!currentUser) return;
    const fetchWallet = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "wallet"), where("uid", "==", currentUser.uid))
        );
        const docs: WalletDocument[] = [];
        snap.forEach((d) => docs.push({ id: d.id, ...d.data() } as WalletDocument));
        setWalletDocs(docs);
      } catch (err) {
        console.error("Failed to load wallet docs for matcher:", err);
      }
    };
    fetchWallet();
  }, [currentUser]);

  // 2. Fetch public profile links (GitHub, LinkedIn, LeetCode, portfolio)
  useEffect(() => {
    if (!currentUser) return;
    return subscribeProfileLinks(currentUser.uid, setProfileLinks);
  }, [currentUser]);

  // 3. Fetch saved bookmarks
  useEffect(() => {
    if (!currentUser) return;
    const fetchSaved = async () => {
      try {
        const snap = await getDoc(doc(db, "bookmarks", currentUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          const ids: string[] = data.opportunityIds || [];
          const itemIds: string[] = Array.isArray(data.items) ? data.items.map((i: any) => i.id) : [];
          setSavedIds(new Set([...ids, ...itemIds]));
        }
      } catch (err) {
        console.error("Failed to load bookmarks:", err);
      }
    };
    fetchSaved();
  }, [currentUser]);

  // Extract all searchable keywords, skills, and evidence from user's assets
  const userSkills = (profile?.skills || []).map((s) => s.toLowerCase());
  const userInterests = (profile?.interests || []).map((i) => i.toLowerCase());
  const userEducation = (profile?.education || "").toLowerCase();

  // Aggregate insights & text from wallet documents
  const walletSkills = new Set<string>();
  const walletTech = new Set<string>();
  const docNames: string[] = [];

  walletDocs.forEach((doc) => {
    docNames.push(doc.name);
    if (doc.insights) {
      (doc.insights.skills || []).forEach((s) => walletSkills.add(s.toLowerCase()));
      (doc.insights.technologies || []).forEach((t) => walletTech.add(t.toLowerCase()));
    }
  });

  // Check linked coding/professional profiles
  const hasGithub = profileLinks.some((l) => l.kind === "github" || l.url.includes("github.com"));
  const hasLinkedIn = profileLinks.some((l) => l.kind === "linkedin" || l.url.includes("linkedin.com"));
  const hasLeetcode = profileLinks.some((l) => l.kind === "leetcode" || l.url.includes("leetcode.com"));
  const hasPortfolio = profileLinks.some((l) => l.kind === "website" || l.url.includes("portfolio") || l.url.includes(".dev") || l.url.includes(".me"));

  // Calculate detailed opportunity match audit
  const scoredOpportunities = opportunities.map((opp) => {
    let score = 40; // baseline
    const matchesFound: string[] = [];
    const missingExpected: string[] = [];
    const evidenceEvidence: string[] = [];

    const oppCategory = (opp.category || "").toLowerCase();
    const oppField = (opp.field || "").toLowerCase();
    const textToMatch = `${opp.title} ${opp.description || ""} ${opp.field || ""} ${opp.category || ""}`.toLowerCase();

    // 1. Skill check (Profile & Wallet)
    userSkills.forEach((skill) => {
      if (textToMatch.includes(skill)) {
        score += 10;
        matchesFound.push(`Profile Skill: ${skill}`);
      }
    });

    walletSkills.forEach((skill) => {
      if (textToMatch.includes(skill) && !matchesFound.includes(`Wallet Skill: ${skill}`)) {
        score += 8;
        evidenceEvidence.push(`Wallet Document verified skill: ${skill}`);
      }
    });

    walletTech.forEach((tech) => {
      if (textToMatch.includes(tech)) {
        score += 6;
        evidenceEvidence.push(`Tech match from wallet: ${tech}`);
      }
    });

    // 2. Category specific evidence
    if (oppCategory.includes("hackathon") || oppCategory.includes("internship") || oppCategory.includes("research") || oppField.includes("computer") || oppField.includes("tech") || oppField.includes("software")) {
      if (hasGithub) {
        score += 12;
        evidenceEvidence.push("Verified GitHub Profile linked in Wallet");
      } else {
        missingExpected.push("GitHub Profile link recommended for technical proof");
      }

      const hasProjectsInWallet = walletDocs.some((d) => d.category === "Projects");
      if (hasProjectsInWallet) {
        score += 10;
        evidenceEvidence.push("Project documentation found in Wallet");
      } else {
        missingExpected.push("Project report or code artifacts in Wallet");
      }
    }

    if (oppCategory.includes("scholarship") || oppCategory.includes("fellowship")) {
      const hasMarksheet = walletDocs.some((d) => d.category === "Results" || d.name.toLowerCase().includes("marksheet") || d.name.toLowerCase().includes("transcript"));
      if (hasMarksheet) {
        score += 15;
        evidenceEvidence.push("Academic Transcript / Marksheet verified in Wallet");
      } else {
        missingExpected.push("Academic transcript / result document required for scholarships");
      }
    }

    const hasResumeInWallet = walletDocs.some((d) => d.category === "Resume" || d.name.toLowerCase().includes("resume") || d.name.toLowerCase().includes("cv"));
    if (hasResumeInWallet) {
      score += 8;
      evidenceEvidence.push("Updated Resume / CV available in Wallet");
    } else {
      missingExpected.push("Upload your latest Resume in Wallet to boost ATS score");
    }

    // 3. Education & Interests
    if (userEducation && textToMatch.includes(userEducation)) {
      score += 8;
      matchesFound.push(`Education background: ${userEducation}`);
    }

    userInterests.forEach((interest) => {
      if (textToMatch.includes(interest)) {
        score += 6;
        matchesFound.push(`Interest: ${interest}`);
      }
    });

    // Check if this opportunity was bookmarked
    const isSaved = savedIds.has(opp.id);
    if (isSaved) {
      score += 5;
    }

    const matchPercent = Math.min(99, Math.max(38, Math.round(score)));

    // Rating tier
    let ratingTier = "Needs Improvement";
    let tierColor: "success" | "warning" | "danger" | "neutral" = "danger";
    if (matchPercent >= 80) {
      ratingTier = "Strong Fit";
      tierColor = "success";
    } else if (matchPercent >= 65) {
      ratingTier = "Moderate Fit";
      tierColor = "warning";
    }

    return {
      ...opp,
      matchPercent,
      ratingTier,
      tierColor,
      isSaved,
      matchesFound,
      evidenceEvidence,
      missingExpected,
    };
  });

  // Filter and sort
  const filtered = scoredOpportunities.filter((opp) => {
    if (filterMode === "saved") return opp.isSaved;
    return true;
  });

  const sortedOpportunities = [...filtered].sort((a, b) => b.matchPercent - a.matchPercent);
  const displayed = sortedOpportunities.slice(0, showCount);

  return (
    <div className="space-y-8">
      <div>
        <span className="eyebrow">Instrument 01</span>
        <h2 className="mt-2 font-display text-2xl text-foreground">Deep Opportunity Matcher</h2>
        <p className="mt-2 max-w-2xl text-sm text-foreground-muted">
          Cross-examines each opportunity against all assets in your <strong>Digital Wallet</strong> (resumes, project repos, marksheets) and <strong>Profile Links</strong> (GitHub, LinkedIn, LeetCode) to provide an evidence-backed rating and gap audit.
        </p>
      </div>

      {/* Wallet Asset Snapshot summary pill */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-center">
          <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-subtle">Wallet Docs</span>
          <p className="mt-1 font-display text-xl text-foreground">{walletDocs.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-center">
          <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-subtle">Public Links</span>
          <p className="mt-1 font-display text-xl text-foreground">{profileLinks.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-center">
          <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-subtle">GitHub Connected</span>
          <p className="mt-1 font-display text-xl text-foreground">{hasGithub ? "Yes" : "No"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-center">
          <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-subtle">Bookmarked</span>
          <p className="mt-1 font-display text-xl text-foreground">{savedIds.size}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setFilterMode("all")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            filterMode === "all"
              ? "bg-surface-ink text-background"
              : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
          }`}
        >
          All Opportunities ({opportunities.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterMode("saved")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            filterMode === "saved"
              ? "bg-surface-ink text-background"
              : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
          }`}
        >
          <Bookmark className="h-3.5 w-3.5" />
          Saved Only ({savedIds.size})
        </button>
      </div>

      <div className="space-y-6">
        {displayed.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" />}
            title="No opportunities found"
            description={
              filterMode === "saved"
                ? "You haven't bookmarked any opportunities yet. Save some to see them ranked here!"
                : "Check back once opportunities are available in the database."
            }
          />
        ) : (
          <>
            <p className="text-xs text-foreground-subtle">
              Showing <span className="font-semibold text-foreground">{displayed.length}</span>{" "}
              of <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
              opportunities evaluated with Wallet evidence
            </p>
            <Stagger as="ul" className="grid grid-cols-1 gap-4">
              {displayed.map((opportunity) => {
                const isExpanded = expandedId === opportunity.id;
                return (
                  <StaggerItem as="li" key={opportunity.id}>
                    <Card className="overflow-hidden p-5 transition-shadow hover:shadow-md sm:p-6">
                      <div className="flex items-start justify-between gap-5">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Chip tone="gold">{opportunity.category}</Chip>
                            <span className="text-2xs text-foreground-subtle">{opportunity.field}</span>
                            {opportunity.isSaved && (
                              <span className="inline-flex items-center gap-1 rounded bg-secondary/10 px-2 py-0.5 text-2xs font-semibold text-secondary">
                                <Bookmark className="h-3 w-3 fill-current" />
                                Saved Item
                              </span>
                            )}
                            <div className="ml-auto flex items-center gap-2">
                              <Chip tone={opportunity.tierColor}>{opportunity.ratingTier}</Chip>
                              <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-3 py-1 text-xs font-bold text-secondary">
                                <Sparkles className="h-3.5 w-3.5" />
                                {opportunity.matchPercent}% Match
                              </span>
                            </div>
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
                      </div>

                      {/* Match Analysis Toggle Button */}
                      <div className="mt-4 border-t border-border/80 pt-3">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : opportunity.id)}
                          className="flex w-full items-center justify-between text-xs font-medium text-foreground-muted hover:text-foreground"
                        >
                          <span className="inline-flex items-center gap-1.5 text-secondary">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isExpanded ? "Hide Match Audit & Wallet Evidence" : "View Match Basis (Why this rating?)"}
                          </span>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>

                        {/* Expanded Audit Card */}
                        {isExpanded && (
                          <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface-subtle p-4 text-xs">
                            {/* Evidence Found in Wallet & Profile */}
                            <div>
                              <span className="font-semibold text-foreground">✅ Strong Evidence Found in Wallet & Links:</span>
                              {opportunity.evidenceEvidence.length > 0 || opportunity.matchesFound.length > 0 ? (
                                <ul className="mt-1.5 space-y-1 text-foreground-muted">
                                  {opportunity.evidenceEvidence.map((e, idx) => (
                                    <li key={`ev-${idx}`} className="flex items-center gap-1.5 text-success">
                                      <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
                                      {e}
                                    </li>
                                  ))}
                                  {opportunity.matchesFound.map((m, idx) => (
                                    <li key={`mf-${idx}`} className="flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-secondary shrink-0" />
                                      {m}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-foreground-subtle italic">No direct keyword overlap found with uploaded documents.</p>
                              )}
                            </div>

                            {/* Missing / Expected Proof */}
                            <div>
                              <span className="font-semibold text-danger">⚠️ What is Missing / Recommended to Boost Fit:</span>
                              {opportunity.missingExpected.length > 0 ? (
                                <ul className="mt-1.5 space-y-1 text-danger">
                                  {opportunity.missingExpected.map((miss, idx) => (
                                    <li key={`miss-${idx}`} className="flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-danger shrink-0" />
                                      {miss}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-success">Your wallet and profile fulfill all primary expected qualifications!</p>
                              )}
                            </div>

                            <div className="pt-2 border-t border-border flex items-center justify-between text-2xs text-foreground-subtle">
                              <span>Field context: {opportunity.field || "General"}</span>
                              <Link href="/dashboard/wallet" className="text-secondary hover:underline inline-flex items-center gap-1 font-medium">
                                Manage Wallet Documents
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
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

            {filtered.length > showCount && (
              <Button
                variant="quiet"
                block
                onClick={() => setShowCount((c) => c + 8)}
                className="border border-border"
              >
                Load {Math.min(8, filtered.length - showCount)} more opportunities
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
  const [result, setResult] = useState<RichAudit | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [targetJob, setTargetJob] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [analysisError, setAnalysisError] = useState("");

  const fetchHistory = async () => {
    if (!currentUser) return;
    try {
      // Query without composite ordering so missing Firestore index doesn't throw
      const q = query(
        collection(db, "resume_analyses"),
        where("uid", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      setHistory(list.slice(0, 3));
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileUpload = async (file: File) => {
    setExtractError("");
    setExtracting(true);
    setUploadedFileName(file.name);
    setSelectedFile(file);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "txt") {
        const text = await file.text();
        setResumeText(text.trim());
      } else {
        // For PDF and DOCX, we send file directly to server-side parser
        setResumeText(`[Uploaded File: ${file.name}] (Server-side parser will analyze contents)`);
      }
    } catch (err: any) {
      console.error("Resume file preview failed:", err);
      setExtractError(err?.message || "Failed to read this file.");
    } finally {
      setExtracting(false);
    }
  };

  const flatToRich = (a: ResumeAnalysisResult): RichAudit =>
    richAudit({
      atsScore: a.atsScore,
      executiveSummary: a.formattingFeedback,
      strengths: a.strengths,
      criticalNegatives: a.weaknesses,
      missingRecommendedKeywords: a.missingSkills,
      actionPlan: a.improvementSuggestions,
    });

  const analyzeResume = async () => {
    if (!resumeText.trim() && !selectedFile) return;
    setLoading(true);
    setAnalysisError("");
    try {
      let audit: RichAudit;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (targetJob.trim()) formData.append("targetJobDescription", targetJob.trim());
        const res = await authedFetch("/api/resume/analyze", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Analysis failed with status ${res.status}`);
        }
        const data = await res.json();
        audit = richAudit(data.audit);
      } else {
        const body: Record<string, string> = { resumeText };
        if (targetJob.trim()) body.targetJobDescription = targetJob.trim();
        const res = await authedFetch("/api/resume/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          audit = richAudit(data.audit);
        } else {
          // Fallback to the legacy action when the server analyser is unavailable.
          const legacy = await AIServiceClient.analyzeResume(resumeText);
          audit = flatToRich(legacy);
        }
      }

      setResult(audit);

      if (currentUser) {
        await addDoc(collection(db, "resume_analyses"), {
          uid: currentUser.uid,
          atsScore: audit.atsScore,
          weaknesses: audit.criticalNegatives,
          missingSkills: audit.missingRecommendedKeywords,
          formattingFeedback: audit.executiveSummary,
          improvementSuggestions: audit.actionPlan,
          strengths: audit.strengths,
          audit,
          timestamp: new Date().toISOString(),
        });
        await fetchHistory();
      }
    } catch (error: any) {
      console.error(error);
      setResult(null);
      setAnalysisError(
        error?.message || "Could not analyze your resume right now. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (!result) return;
    setAnalysisError("");
    try {
      const res = await authedFetch("/api/resume/download-audit-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit: result, fileName: uploadedFileName || "Resume" }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `PDF export failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(uploadedFileName || "Resume").replace(/\.[^.]+$/, "")}_ATS_Report.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setAnalysisError(err?.message || "Could not generate the PDF report.");
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
                    setSelectedFile(null);
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

        <Textarea
          label="Target job description (optional — enables Job Match %)"
          rows={3}
          placeholder="Paste the job posting you're targeting. Adds matched/missing keyword analysis and a match score…"
          value={targetJob}
          onChange={(e) => setTargetJob(e.target.value)}
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
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised px-5 py-4">
            <div>
              <span className="eyebrow">ATS Score Estimation</span>
              <span className="mt-2 block font-display text-4xl leading-none text-foreground">
                {result.atsScore}
                <span className="text-lg text-foreground-subtle">/100</span>
              </span>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.verdict && (
                  <Chip tone={result.atsScore >= 85 ? "success" : result.atsScore >= 70 ? "warning" : "danger"}>
                    {result.verdict}
                  </Chip>
                )}
                {typeof result.readabilityScore === "number" && (
                  <Chip tone="info">Readability {result.readabilityScore}/100</Chip>
                )}
                {result.atsScore >= 75 ? (
                  <Chip tone="success">Ready to Apply</Chip>
                ) : (
                  <Chip tone="warning">Needs Revision</Chip>
                )}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download className="h-4 w-4" />}
              onClick={downloadPdf}
            >
              Download PDF Report
            </Button>
          </div>

          {result.jobMatch && (
            <Card tone="raised" className="p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="eyebrow">Job match</span>
                <span className="font-display text-2xl text-foreground">{result.jobMatch.score}%</span>
              </div>
              {result.jobMatch.summary && (
                <p className="mt-2 text-sm leading-relaxed text-foreground">{result.jobMatch.summary}</p>
              )}
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {result.jobMatch.matchedKeywords.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-success">Matched keywords</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.jobMatch.matchedKeywords.map((k, i) => (
                        <Chip key={i} tone="success">{k}</Chip>
                      ))}
                    </div>
                  </div>
                )}
                {result.jobMatch.missingKeywords.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-danger">Missing from resume</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.jobMatch.missingKeywords.map((k, i) => (
                        <Chip key={i} tone="danger">{k}</Chip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card tone="raised" className="p-5">
            <span className="eyebrow">Score breakdown</span>
            <div className="mt-4 space-y-3">
              {BREAKDOWN_LABELS.map(({ key, label }) => {
                const v = result.breakdown[key];
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground-muted">{label}</span>
                      <span className="font-display text-foreground">{v}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-ink/10">
                      <div className="h-full rounded-full bg-secondary" style={{ width: `${v}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {result.executiveSummary && (
            <Card tone="inset" className="p-5">
              <span className="eyebrow">Executive summary</span>
              <p className="mt-2 text-sm leading-relaxed text-foreground">{result.executiveSummary}</p>
            </Card>
          )}

          {(result.contactInfo || result.quantifiedImpact) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {result.contactInfo && (
                <Card tone="raised" className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="eyebrow">Contact info</span>
                    <Chip tone={result.contactInfo.complete ? "success" : "warning"}>
                      {result.contactInfo.complete ? "Complete" : "Incomplete"}
                    </Chip>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {result.contactInfo.present.map((p, i) => (
                      <li key={i} className="flex gap-2 text-sm text-foreground">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <span className="text-foreground-muted">{p.label}:</span> {p.value}
                      </li>
                    ))}
                  </ul>
                  {result.contactInfo.missing.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {result.contactInfo.missing.map((m, i) => (
                        <Chip key={i} tone="danger">{m}</Chip>
                      ))}
                    </div>
                  )}
                  {result.contactInfo.suggestion && (
                    <p className="mt-3 text-sm text-foreground-muted">{result.contactInfo.suggestion}</p>
                  )}
                </Card>
              )}

              {result.quantifiedImpact && (
                <Card tone="raised" className="p-5">
                  <span className="eyebrow">Quantified impact</span>
                  <p className="mt-2 text-sm text-foreground">
                    <span className="font-display text-2xl">{result.quantifiedImpact.detected}</span>{" "}
                    <span className="text-foreground-muted">metric-backed bullets</span>
                  </p>
                  {result.quantifiedImpact.bulletsWithoutMetrics.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-warning">Add numbers to</span>
                      <ul className="mt-2 space-y-1.5">
                        {result.quantifiedImpact.bulletsWithoutMetrics.map((b, i) => (
                          <li key={i} className="flex gap-2 text-sm text-foreground-muted">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.quantifiedImpact.suggestion && (
                    <p className="mt-3 text-sm text-foreground-muted">{result.quantifiedImpact.suggestion}</p>
                  )}
                </Card>
              )}
            </div>
          )}

          {result.sections && result.sections.length > 0 && (
            <Card tone="raised" className="p-5">
              <span className="eyebrow">Sections detected</span>
              <ul className="mt-3 flex flex-wrap gap-2">
                {result.sections.map((s, i) => (
                  <li key={i}>
                    <Chip tone={s.present ? "success" : "danger"}>
                      {s.present ? "✓" : "✗"} {s.name}
                    </Chip>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
                {result.criticalNegatives.map((w, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> {w}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card tone="raised" className="p-5">
              <span className="eyebrow">ATS keywords found</span>
              {result.atsKeywordsFound.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {result.atsKeywordsFound.map((k, i) => (
                    <li key={i}><Chip tone="success">{k}</Chip></li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-foreground-muted">No keywords were detected.</p>
              )}
            </Card>

            <Card tone="raised" className="p-5">
              <span className="eyebrow">Missing recommended keywords</span>
              {result.missingRecommendedKeywords.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {result.missingRecommendedKeywords.map((k, i) => (
                    <li key={i}><Chip tone="gold">{k}</Chip></li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-foreground-muted">Nothing obvious is missing.</p>
              )}
            </Card>
          </div>

          {result.bulletImprovements.length > 0 && (
            <Card tone="raised" className="p-5">
              <span className="eyebrow">Bullet rewrites</span>
              <div className="mt-3 space-y-3">
                {result.bulletImprovements.map((b, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface p-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-danger">Original</span>
                    <p className="mt-1 text-sm text-foreground-muted">{b.original}</p>
                    <span className="mt-3 block text-xs font-semibold uppercase tracking-wider text-success">Improved</span>
                    <p className="mt-1 text-sm text-foreground">{b.improved}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {((result.talentGaps && result.talentGaps.length > 0) || (result.interviewQuestions && result.interviewQuestions.length > 0)) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {result.talentGaps && result.talentGaps.length > 0 && (
                <Card tone="raised" className="p-5">
                  <span className="eyebrow">Talent gaps</span>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {result.talentGaps.map((g, i) => (
                      <li key={i}><Chip tone="warning">{g}</Chip></li>
                    ))}
                  </ul>
                </Card>
              )}
              {result.interviewQuestions && result.interviewQuestions.length > 0 && (
                <Card tone="raised" className="p-5">
                  <span className="eyebrow">Likely interview questions</span>
                  <ul className="mt-3 space-y-2">
                    {result.interviewQuestions.map((q, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-foreground">
                        <span className="font-display text-foreground-subtle">{i + 1}.</span> {q}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}

          {result.actionPlan.length > 0 && (
            <Card tone="raised" className="p-5">
              <span className="eyebrow">Action plan</span>
              <ul className="mt-3 space-y-2">
                {result.actionPlan.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground-muted">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" />
                    {s}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Reveal>
      )}

      {history.length > 0 && (
        <div className="border-t border-border pt-8">
          <span className="eyebrow mb-4">Recent analysis history (Click to view)</span>
          <ul className="space-y-2">
            {history.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    if (h.audit) {
                      setResult(richAudit(h.audit));
                    } else {
                      setResult(
                        richAudit({
                          atsScore: h.atsScore,
                          strengths: h.strengths || [],
                          criticalNegatives: h.weaknesses || [],
                          missingRecommendedKeywords: h.missingSkills || [],
                          executiveSummary: h.formattingFeedback || "",
                          actionPlan: h.improvementSuggestions || [],
                        })
                      );
                    }
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-md bg-surface-raised px-4 py-3 text-left transition-colors hover:border-secondary hover:bg-surface"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-display text-lg text-foreground">{h.atsScore}/100</span>
                    <Chip tone={h.atsScore >= 75 ? "success" : "warning"}>
                      {h.atsScore >= 75 ? "Ready" : "Needs Polish"}
                    </Chip>
                  </div>
                  <span className="text-xs text-foreground-subtle">
                    {new Date(h.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </button>
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
interface ChatMessage {
  role: "user" | "model";
  text: string;
  attachments?: { name: string; kind: "doc" | "image" }[];
}

interface ChatAttachment {
  id: string;
  name: string;
  kind: "doc" | "image";
  size: number;
  file: File;
}

function ChatTab() {
  const { currentUser, profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

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
            text: "Hello! I am your AI career advisor at NEXORA. How can I help you find target opportunities, optimize your resume, or prepare for applications today? You can also **paste multiple files** (PDF, DOCX, TXT, or images) and I will read them for you.",
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

  const fileKind = (name: string): "doc" | "image" => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) ? "image" : "doc";
  };

  const attachFiles = (files: Iterable<File>) => {
    setChatError("");
    const incoming = Array.from(files).filter((f) => f.size > 0);
    if (incoming.length === 0) return;
    const combined = [...attachments];
    for (const file of incoming) {
      if (combined.length >= MAX_ATTACHMENTS) {
        setChatError(`You can attach up to ${MAX_ATTACHMENTS} files at a time.`);
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setChatError(`"${file.name}" is over 8 MB. Please attach a smaller file.`);
        continue;
      }
      combined.push({
        id: `${file.name}-${Date.now()}-${combined.length}`,
        name: file.name,
        kind: fileKind(file.name),
        size: file.size,
        file,
      });
    }
    setAttachments(combined);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      attachFiles(e.clipboardData.files);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || loading) return;

    const userMsg = input.trim();
    const files = attachments.map((a) => a.file);
    const meta = attachments.map((a) => ({ name: a.name, kind: a.kind }));
    setInput("");
    setAttachments([]);

    const userMessage: ChatMessage = { role: "user", text: userMsg };
    if (meta.length > 0) userMessage.attachments = meta;
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setLoading(true);
    setChatError("");

    try {
      const chatResponse = await AIServiceClient.chatWithFiles(
        userMsg,
        newMessages,
        profile || {},
        files
      );

      const finalMessages: ChatMessage[] = [
        ...newMessages,
        { role: "model", text: chatResponse.reply },
      ];
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
    <div className="flex h-[38rem] flex-col space-y-6">
      <div>
        <span className="eyebrow">Instrument 03</span>
        <h2 className="mt-2 font-display text-2xl text-foreground">AI Career Chatbot</h2>
        <p className="mt-2 max-w-xl text-sm text-foreground-muted">
          Chat with a context-aware assistant loaded with your profile settings. Paste or attach
          PDF, DOCX, TXT, or image files and the advisor will read them and reply in markdown.
        </p>
      </div>

      <div
        className="card-inset flex min-h-0 flex-1 flex-col overflow-hidden"
        onPaste={handlePaste}
      >
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
                {m.role === "model" && m.text ? (
                  <MarkdownText text={m.text} />
                ) : (
                  m.text
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.attachments.map((a, ai) => (
                      <span
                        key={ai}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.7rem] font-medium ${
                          m.role === "user" ? "bg-white/15 text-white" : "bg-muted text-foreground-muted"
                        }`}
                      >
                        <FileText className="h-3 w-3" /> {a.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground-muted">
                <Loader2 className="h-3.5 w-3.5 spin text-secondary" />
                <span>NEXORA Advisor is reading your files and formulating advice…</span>
              </div>
            </div>
          )}
          {chatError && <ErrorState description={chatError} className="items-start py-4 text-left" />}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border px-4 pt-3">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-foreground"
              >
                <FileText className="h-3 w-3 text-secondary" />
                {a.name}
                <span className="text-foreground-subtle">· {bytesLabel(a.size)}</span>
                <button
                  type="button"
                  onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))}
                  className="rounded-sm p-0.5 transition-colors hover:bg-surface hover:text-foreground"
                  aria-label={`Remove ${a.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={sendMessage} className="flex gap-2 border-t border-border p-4">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.png,.jpg,.jpeg,.webp"
            className="sr-only"
            disabled={loading}
            onChange={(e) => {
              if (e.target.files) attachFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach files"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
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
            disabled={loading || (!input.trim() && attachments.length === 0)}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

