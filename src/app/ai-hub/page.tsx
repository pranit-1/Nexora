"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { Opportunity } from "@/lib/mockData";
import { useOpportunities } from "@/hooks/useOpportunities";
import { AIServiceClient, AIServiceUnavailableError, ResumeAnalysisResult, InterviewFeedbackResult } from "@/lib/aiServiceClient";
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
  X
} from "lucide-react";
import { fetchPerformanceProfile } from "@/lib/performanceProfileClient";
import { Button, Card, Chip, EmptyState, ErrorState, Select, Stat, Textarea } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

/** Hoisted so the nav does not rebuild the array on every render. */
const TABS = [
  { id: "recommendations", label: "Opportunity Matcher", icon: Award },
  { id: "resume", label: "ATS Resume Scan", icon: FileText },
  { id: "chat", label: "Career Chatbot", icon: MessageSquare },
  { id: "interview", label: "Interview Coach", icon: Zap },
  { id: "analytics", label: "Performance Tracker", icon: LineChart },
] as const;

type TabId = (typeof TABS)[number]["id"];

const INTERVIEW_ROLES = [
  { value: "Frontend Engineer", label: "Frontend Engineer" },
  { value: "Backend Engineer", label: "Backend Engineer" },
  { value: "Product Manager", label: "Product Manager" },
];

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

  const [activeTab, setActiveTab] = useState<
    "recommendations" | "resume" | "chat" | "interview" | "analytics"
  >("recommendations");

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
              Check opportunities, analyze your resume, mock-interview with an AI coach, and chat
              with our career assistant.
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
                {activeTab === "interview" && <InterviewTab />}
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
   TAB 6: INTERVIEW COACH
   ========================================================================== */
function InterviewTab() {
  const { currentUser } = useAuth();
  const [jobTitle, setJobTitle] = useState("Frontend Engineer");
  const [stage, setStage] = useState<"setup" | "interviewing" | "feedback">("setup");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<InterviewFeedbackResult | null>(null);
  const [interviewError, setInterviewError] = useState("");

  const startInterview = () => {
    // Generate questions locally based on role for rule compliance
    const interviewQuestionsMap: Record<string, string[]> = {
      "Frontend Engineer": [
        "What are the benefits of Server Components vs Client Components in Next.js?",
        "Explain how closures work in JavaScript and why you might use one.",
        "How do you optimize page loading performance in React applications?"
      ],
      "Backend Engineer": [
        "How would you handle database connection pooling in a scalable Node.js application?",
        "Explain the differences between SQL and NoSQL database structures.",
        "What are the best practices for designing a secure and scalable REST API?"
      ],
      "Product Manager": [
        "How do you prioritize features for a product roadmap under resource constraints?",
        "Explain how you would measure user engagement metrics for a new feature.",
        "How do you manage disagreements between design and software engineering teams?"
      ]
    };

    const qs = interviewQuestionsMap[jobTitle] || interviewQuestionsMap["Frontend Engineer"];
    setQuestions(qs);
    setAnswers(new Array(qs.length).fill(""));
    setCurrentIdx(0);
    setStage("interviewing");
  };

  const handleAnswerSubmit = async () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx((prev) => prev + 1);
    } else {
      // Evaluate answers with Gemini
      setLoading(true);
      setStage("feedback");
      setInterviewError("");
      try {
        const payload = questions.map((q, idx) => ({
          question: q,
          answer: answers[idx],
        }));

        const result = await AIServiceClient.getInterviewFeedback(jobTitle, payload);
        setFeedback(result);

        if (currentUser) {
          await addDoc(collection(db, "interviews"), {
            uid: currentUser.uid,
            jobTitle,
            feedback: result,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(err);
        setFeedback(null);
        setStage("interviewing");
        setCurrentIdx(questions.length - 1);
        setInterviewError(
          err instanceof AIServiceUnavailableError
            ? err.message
            : "Could not review your answers right now. Please try again."
        );
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <span className="eyebrow">Instrument 04</span>
        <h2 className="mt-2 font-display text-2xl text-foreground">AI Technical Interview Coach</h2>
        <p className="mt-2 max-w-xl text-sm text-foreground-muted">
          Simulate structured questions based on chosen roles and receive technical feedback
          summaries from Gemini.
        </p>
      </div>

      {stage === "setup" && (
        <Card tone="raised" className="space-y-6 p-6">
          <Select
            label="Select position role"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            options={INTERVIEW_ROLES}
          />
          <Button block onClick={startInterview}>
            Begin Interview Session
          </Button>
        </Card>
      )}

      {stage === "interviewing" && questions.length > 0 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <span className="eyebrow">
              Question {currentIdx + 1} of {questions.length}
            </span>
            <Chip tone="gold">{jobTitle}</Chip>
          </div>

          <Card tone="inset" className="p-6">
            <p className="font-display text-lg leading-relaxed text-foreground">
              {questions[currentIdx]}
            </p>
          </Card>

          <Textarea
            label="Your answer"
            rows={6}
            placeholder="Type your response to the question in detail…"
            value={answers[currentIdx]}
            onChange={(e) => {
              const updated = [...answers];
              updated[currentIdx] = e.target.value;
              setAnswers(updated);
            }}
          />

          <Button block onClick={handleAnswerSubmit} disabled={!answers[currentIdx].trim()}>
            {currentIdx < questions.length - 1 ? "Next Question" : "Complete & Evaluate"}
          </Button>
        </div>
      )}

      {stage === "feedback" && (
        <div className="space-y-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-7 w-7 spin text-secondary" />
              <span className="text-sm text-foreground-muted">
                Gemini is evaluating your responses…
              </span>
            </div>
          ) : interviewError ? (
            <ErrorState description={interviewError} />
          ) : (
            feedback && (
              <Reveal className="space-y-5">
                <div className="rounded-lg border border-border bg-surface-raised px-5 py-4">
                  <span className="eyebrow">Confidence &amp; tone rating</span>
                  <span className="mt-2 block font-display text-4xl leading-none text-foreground">
                    {feedback.confidenceScore}
                    <span className="text-lg text-foreground-subtle">/100</span>
                  </span>
                </div>

                <Card tone="raised" className="space-y-3 p-5">
                  <span className="eyebrow">Technical evaluation</span>
                  <p className="text-sm leading-relaxed text-foreground">
                    {feedback.technicalFeedback}
                  </p>
                </Card>

                <Card tone="raised" className="space-y-3 p-5">
                  <span className="eyebrow">Communication &amp; structure</span>
                  <p className="text-sm leading-relaxed text-foreground">
                    {feedback.communicationFeedback}
                  </p>
                </Card>

                <Card tone="raised" className="space-y-3 p-5">
                  <span className="eyebrow">Improvement suggestions</span>
                  <ul className="space-y-2">
                    {feedback.improvementSuggestions.map((s, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-foreground">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </Card>

                {feedback.followUpQuestions && feedback.followUpQuestions.length > 0 && (
                  <Card tone="raised" className="space-y-3 p-5">
                    <span className="eyebrow">Follow-up questions to practice</span>
                    <ul className="space-y-2">
                      {feedback.followUpQuestions.map((q, i) => (
                        <li key={i} className="border-l-2 border-border pl-3 font-display text-sm italic text-foreground">
                          {q}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <Button
                  variant="secondary"
                  block
                  onClick={() => setStage("setup")}
                >
                  Start New Session
                </Button>
              </Reveal>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   TAB 7: ANALYTICS & CONFIDENCE TRACKER
   ========================================================================== */
function AnalyticsTab() {
  const { currentUser, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    profileCompletion: 0,
    resumeScanScore: 0,
    interviewSessionCount: 0,
    performanceScore: 0,
  });
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState("");

  // Profile completion is calculated from the actual fields the user has
  // filled in — NOT a fixed placeholder. Each field is weighted equally.
  const computeProfileCompletion = (): number => {
    if (!profile) return 0;
    const fields: (keyof typeof profile)[] = [
      "bio",
      "education",
      "skills",
      "interests",
      "location",
      "income",
    ];
    const filled = fields.filter((f) => {
      const val = profile[f];
      if (Array.isArray(val)) return val.length > 0;
      return typeof val === "string" && val.trim().length > 0;
    }).length;
    return Math.round((filled / fields.length) * 100);
  };

  const loadAnalytics = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // Fetch stats
      const resumeSnap = await getDocs(
        query(collection(db, "resume_analyses"), where("uid", "==", currentUser.uid), limit(5))
      );
      let latestATS: number | null = null;
      resumeSnap.forEach((d) => {
        latestATS = d.data().atsScore;
      });

      const interviewSnap = await getDocs(
        query(collection(db, "interviews"), where("uid", "==", currentUser.uid))
      );
      const interviewCount = interviewSnap.size;

      const currentStats = {
        profileCompletion: computeProfileCompletion(),
        // No resume analyzed yet == no score, not a fake placeholder number.
        resumeScanScore: latestATS ?? 0,
        interviewSessionCount: interviewCount,
        // Real document-backed score from the wallet. 0 when the wallet is empty.
        performanceScore: (await fetchPerformanceProfile(currentUser.uid))?.overall ?? 0,
      };

      setStats(currentStats);

      // Generate Gemini tracking text. Failure must not blank out the real
      // Firestore-derived stats above, so the narrative is handled separately.
      setSummaryError("");
      try {
        const progressSummary = await AIServiceClient.trackConfidence(currentStats);
        setSummary(progressSummary);
      } catch (e) {
        console.error(e);
        setSummary("");
        setSummaryError(
          e instanceof AIServiceUnavailableError
            ? e.message
            : "Could not generate a progress summary right now."
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [currentUser, profile]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 spin text-secondary" />
        <span className="sr-only">Compiling your analytics</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <span className="eyebrow">Instrument 05</span>
        <h2 className="mt-2 font-display text-2xl text-foreground">
          AI Performance &amp; Analytics
        </h2>
        <p className="mt-2 max-w-xl text-sm text-foreground-muted">
          Overview metrics compiled from database rule actions, with monthly progress digests
          generated by Gemini.
        </p>
      </div>

      <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StaggerItem>
          <Stat label="Profile Integrity" value={`${stats.profileCompletion}%`} size="sm" />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Latest ATS Score" value={`${stats.resumeScanScore}/100`} size="sm" />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Document Performance" value={`${stats.performanceScore}/100`} size="sm" />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Practice Interviews" value={stats.interviewSessionCount} size="sm" />
        </StaggerItem>
      </Stagger>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="max-w-xl text-sm text-foreground-muted">
          Document Performance is calculated from your wallet documents — marksheets,
          certificates, awards, projects and resume. Add more documents and it moves on its own.
        </p>
        <Link
          href="/dashboard/performance"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary transition-colors duration-base hover:text-secondary-hover"
        >
          Open performance profile
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Card>

      <Card tone="raised" className="flex flex-col items-start gap-5 p-6 md:flex-row">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-secondary/25 bg-accent-gold-surface text-secondary">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className="eyebrow">Monthly AI Progress Summary</span>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">
            {summary || "No summary available."}
          </p>
          {summaryError && <ErrorState description={summaryError} className="mt-4 py-3 text-left" />}
        </div>
      </Card>
    </div>
  );
}
