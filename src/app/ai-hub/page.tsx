"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import type { WalletDocument, ProfileLink } from "@/lib/types";
import { subscribeProfileLinks } from "@/lib/profileLinksClient";
import { Button, Card, Chip, EmptyState, ErrorState, Textarea } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";


const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;





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
  const [result, setResult] = useState<ResumeAnalysisResult | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
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

  const analyzeResume = async () => {
    if (!resumeText.trim() && !selectedFile) return;
    setLoading(true);
    setAnalysisError("");
    try {
      let analysis: ResumeAnalysisResult;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        const res = await authedFetch("/api/resume/analyze", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Analysis failed with status ${res.status}`);
        }
        const data = await res.json();
        const a = data.audit;
        analysis = {
          atsScore: a.atsScore ?? 0,
          strengths: a.strengths || [],
          weaknesses: a.criticalNegatives || a.weaknesses || [],
          missingSkills: a.missingRecommendedKeywords || a.missingSkills || [],
          formattingFeedback: a.executiveSummary || a.formattingFeedback || "",
          improvementSuggestions: (a.actionPlan && a.actionPlan.length > 0)
            ? a.actionPlan
            : (a.bulletImprovements || []).map((b: any) => `${b.original} -> ${b.improved}`),
        };
      } else {
        const res = await authedFetch("/api/resume/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resumeText }),
        });
        if (!res.ok) {
          // Fallback to legacy action if /api/resume/analyze is rejected
          analysis = await AIServiceClient.analyzeResume(resumeText);
        } else {
          const data = await res.json();
          const a = data.audit;
          analysis = {
            atsScore: a.atsScore ?? 0,
            strengths: a.strengths || [],
            weaknesses: a.criticalNegatives || a.weaknesses || [],
            missingSkills: a.missingRecommendedKeywords || a.missingSkills || [],
            formattingFeedback: a.executiveSummary || a.formattingFeedback || "",
            improvementSuggestions: (a.actionPlan && a.actionPlan.length > 0)
              ? a.actionPlan
              : (a.bulletImprovements || []).map((b: any) => `${b.original} -> ${b.improved}`),
          };
        }
      }

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
          <span className="eyebrow mb-4">Recent analysis history (Click to view)</span>
          <ul className="space-y-2">
            {history.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setResult({
                      atsScore: h.atsScore,
                      strengths: h.strengths || [],
                      weaknesses: h.weaknesses || [],
                      missingSkills: h.missingSkills || [],
                      formattingFeedback: h.formattingFeedback || "",
                      improvementSuggestions: h.improvementSuggestions || [],
                    });
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

