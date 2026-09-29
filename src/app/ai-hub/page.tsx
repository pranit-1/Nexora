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
import { AIServiceClient, ResumeAnalysisResult, InterviewFeedbackResult } from "@/lib/aiServiceClient";
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
      <div className="min-h-screen flex items-center justify-center bg-primary/30">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="flex-grow bg-background min-h-screen py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-10 text-center sm:text-left">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1.5 rounded-full">
              <Sparkles className="w-4 h-4" /> AI Hub Workspace
            </span>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground mt-3 tracking-tight">
              Intelligent Career Guidance
            </h1>
            <p className="text-sm text-foreground-muted mt-2 max-w-2xl">
              Check opportunities, analyze your resume, mock-interview with an AI coach, and chat with our career assistant.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Left Nav menu */}
            <div className="lg:col-span-1 space-y-2 bg-surface/70 backdrop-blur border border-border p-5 rounded-3xl shadow-sm h-fit">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-4 px-3">
                AI Instruments
              </h4>
              {[
                { id: "recommendations", label: "Opportunity Matcher", icon: Award },
                { id: "resume", label: "ATS Resume Scan", icon: FileText },
                { id: "chat", label: "Career Chatbot", icon: MessageSquare },
                { id: "interview", label: "Interview Coach", icon: Zap },
                { id: "analytics", label: "Performance Tracker", icon: LineChart },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold text-left transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/10"
                        : "text-foreground-muted hover:bg-primary/10 hover:text-primary"
                    }`}
                  >
                    <Icon className="w-4.5 h-4.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Main Tabs Container */}
            <div className="lg:col-span-3 bg-surface border border-border rounded-3xl p-6 sm:p-8 shadow-sm">
              {activeTab === "recommendations" && <RecommendationsTab />}
              {activeTab === "resume" && <ResumeTab />}
              {activeTab === "chat" && <ChatTab />}
              {activeTab === "interview" && <InterviewTab />}
              {activeTab === "analytics" && <AnalyticsTab />}
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
  const color =
    score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-primary" : "bg-amber-500";
  return (
    <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden mt-1">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
    </div>
  );
}

function RecommendationsTab() {
  const { profile } = useAuth();
  const { opportunities } = useOpportunities();
  const [loading, setLoading] = useState(false);
  const [recs, setRecs] = useState<MatchResult[]>([]);
  const [minScore, setMinScore] = useState(40);
  const [showCount, setShowCount] = useState(6);

  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const runMatcher = () => {
    if (!profile || !opportunities.length) return;
    setLoading(true);

    const userSkills = (profile.skills || []).map((s) => s.toLowerCase().trim());
    const userInterests = (profile.interests || []).map((i) => i.toLowerCase().trim());
    const userCategory = (profile.category || "").toLowerCase().trim();
    const userLocation = (profile.location || "").toLowerCase().trim();
    const userEducation = (profile.education || "").toLowerCase();
    const userBio = profile.bio || "";
    const userIncome = (profile.income || "").toLowerCase();
    const bioTokens = tokenize(userBio);

    const results: MatchResult[] = opportunities.map((opp) => {
      const signals: MatchSignal[] = [];
      let score = 30;

      const oppText = [opp.description, opp.eligibility, opp.field, opp.title]
        .join(" ")
        .toLowerCase();
      const oppTokens = tokenize(oppText);

      // Signal 1: Category exact match (+20)
      if (userCategory && opp.category.toLowerCase() === userCategory) {
        score += 20;
        signals.push({ label: `Category: ${opp.category}`, points: 20, icon: "🎯" });
      }

      // Signal 2: Skills match (+6 per skill, max +30)
      let skillPoints = 0;
      const matchedSkills: string[] = [];
      for (const skill of userSkills) {
        if (oppText.includes(skill) && skillPoints < 30) {
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

      // Signal 3: Interests / field match (+5 per match, max +20)
      let intPoints = 0;
      const matchedInterests: string[] = [];
      for (const interest of userInterests) {
        if (
          (opp.field.toLowerCase().includes(interest) ||
            opp.description.toLowerCase().includes(interest)) &&
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

      // Signal 4: Location / country match (+10)
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

  const filtered = recs.filter((r) => r.score >= minScore).slice(0, showCount);
  const hasProfile =
    profile &&
    ((profile.skills?.length ?? 0) > 0 ||
      (profile.interests?.length ?? 0) > 0 ||
      !!profile.category ||
      !!profile.location);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Award className="w-5 h-5 text-primary" /> Opportunity Matcher
          </h2>
          <p className="text-xs text-foreground-muted mt-1">
            Deep multi-signal matching — skills, interests, location, education, income &amp; bio keywords.
          </p>
        </div>
        <button
          onClick={runMatcher}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Rematch
        </button>
      </div>

      {/* Profile completeness nudge */}
      {!hasProfile && !loading && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-600">Complete your profile for better matches</p>
            <p className="text-xs text-foreground-muted mt-0.5">
              Add skills, interests, location, and education in profile settings to unlock deep matching.
            </p>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      {!loading && recs.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-2">
            <span className="text-foreground-muted font-semibold">Min score:</span>
            {[30, 40, 55, 70].map((v) => (
              <button
                key={v}
                onClick={() => setMinScore(v)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  minScore === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-border/40 text-foreground-muted hover:bg-border"
                }`}
              >
                {v}%+
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-foreground-muted font-semibold">Show:</span>
            {[6, 10, 20].map((v) => (
              <button
                key={v}
                onClick={() => setShowCount(v)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  showCount === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-border/40 text-foreground-muted hover:bg-border"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-xs text-foreground-muted">
              Scanning {opportunities.length} opportunities…
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <TrendingUp className="w-8 h-8 text-foreground-muted mx-auto mb-3" />
            <p className="text-sm font-bold text-foreground">No matches above {minScore}%</p>
            <p className="text-xs text-foreground-muted mt-1">
              Try lowering the minimum score or enriching your profile.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-foreground-muted font-semibold">
              Showing{" "}
              <span className="text-foreground font-bold">{filtered.length}</span> of{" "}
              <span className="text-foreground font-bold">
                {recs.filter((r) => r.score >= minScore).length}
              </span>{" "}
              matches
            </p>
            <div className="grid grid-cols-1 gap-5">
              {filtered.map(({ opportunity, score, signals }) => {
                const scoreColor =
                  score >= 80 ? "text-emerald-500" : score >= 60 ? "text-primary" : "text-amber-500";
                const badgeColor =
                  score >= 80
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : score >= 60
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/20";

                return (
                  <div
                    key={opportunity.id}
                    className="bg-surface border border-border hover:border-primary/30 p-5 rounded-3xl shadow-sm hover:shadow-md transition-all"
                  >
                    {/* Top Row */}
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            {opportunity.category}
                          </span>
                          <span className="text-[9px] font-semibold text-foreground-muted">
                            {opportunity.field}
                          </span>
                        </div>
                        <h3 className="font-extrabold text-foreground text-sm leading-snug hover:text-primary transition-colors">
                          <Link href={`/opportunity/${opportunity.id}`}>{opportunity.title}</Link>
                        </h3>
                        <p className="text-foreground-muted text-xs font-semibold mt-0.5">
                          {opportunity.organization} · {opportunity.country}
                        </p>
                      </div>

                      {/* Score Badge */}
                      <div className={`text-center border rounded-2xl px-3 py-2 flex-shrink-0 ${badgeColor}`}>
                        <span className={`block text-xl font-black ${scoreColor}`}>{score}%</span>
                        <span className="block text-[9px] font-bold uppercase tracking-wider opacity-70">
                          Match
                        </span>
                        <ScoreBar score={score} />
                      </div>
                    </div>

                    {/* Signal Chips */}
                    {signals.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-4">
                        {signals.map((sig, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold bg-primary/10 border border-primary/15 text-foreground px-2.5 py-1 rounded-full"
                          >
                            <span>{sig.icon}</span>
                            {sig.label}
                            <span className="text-primary font-bold ml-0.5">+{sig.points}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Deadline + CTA */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                      <span className="text-[10px] text-foreground-muted font-semibold">
                        Deadline:{" "}
                        <span className="text-foreground">
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
                        className="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                      >
                        View Details <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" /> AI ATS Resume Scanner
        </h2>
        <p className="text-xs text-foreground-muted mt-1">
          Paste your resume text to get formatted formatting advice, ATS scoring, and skill addition templates from Gemini.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] uppercase font-bold text-foreground-muted mb-2">
            Upload Resume File
          </label>
          <label className="flex items-center justify-center gap-2 py-4 px-4 bg-surface-raised border border-dashed border-border-strong rounded-2xl text-xs font-bold text-foreground-muted hover:bg-surface-raised hover:border-primary transition-all cursor-pointer">
            {extracting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Reading {uploadedFileName}...
              </>
            ) : uploadedFileName ? (
              <>
                <FileText className="w-4 h-4 text-primary" /> {uploadedFileName}
                <span
                  role="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setUploadedFileName("");
                    setResumeText("");
                    setExtractError("");
                  }}
                  className="ml-2 p-1 rounded-full hover:bg-surface-raised"
                >
                  <X className="w-3 h-3" />
                </span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" /> Click to upload a .pdf, .docx, or .txt resume
              </>
            )}
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              disabled={extracting}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = "";
              }}
            />
          </label>
          {extractError && (
            <p className="text-[10px] text-danger font-semibold mt-2">{extractError}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] font-bold text-foreground-muted uppercase">or paste manually</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div>
          <label className="block text-[10px] uppercase font-bold text-foreground-muted mb-2">
            Paste Resume Plain Text
          </label>
          <textarea
            rows={6}
            placeholder="Paste raw text of your resume here to analyze structure, skills, and formats..."
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            className="w-full text-xs p-4 bg-surface-raised border border-border rounded-2xl outline-none focus:bg-surface focus:border-primary resize-none"
          />
        </div>

        <button
          onClick={analyzeResume}
          disabled={loading || !resumeText.trim()}
          className="w-full py-3 bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run AI Scan & ATS Grade"}
        </button>
      </div>

      {result && (
        <div className="border-t border-border pt-6 space-y-5">
          <div className="p-5 bg-primary/30 rounded-2xl border border-primary/10 flex justify-between items-center">
            <div>
              <h4 className="text-foreground-muted text-[10px] font-bold uppercase tracking-wider">
                ATS Score Estimation
              </h4>
              <span className="text-3xl font-black text-primary">{result.atsScore}/100</span>
            </div>
            <div>
              {result.atsScore >= 75 ? (
                <span className="text-[10px] font-bold text-success bg-success-surface px-2.5 py-1 rounded-full border border-success/30">
                  Ready to Apply
                </span>
              ) : (
                <span className="text-[10px] font-bold text-warning bg-warning-surface px-2.5 py-1 rounded-full border border-warning/30">
                  Needs Revision
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-surface-raised p-4 rounded-2xl border border-border">
              <h5 className="text-[10px] uppercase font-bold text-foreground-muted mb-2">Strengths Identified</h5>
              <ul className="space-y-1">
                {result.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-foreground flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-success" /> {s}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-surface-raised p-4 rounded-2xl border border-border">
              <h5 className="text-[10px] uppercase font-bold text-foreground-muted mb-2">Areas of Weaknesses</h5>
              <ul className="space-y-1">
                {result.weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-foreground flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-danger" /> {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-surface-raised p-4 rounded-2xl border border-border">
            <h5 className="text-[10px] uppercase font-bold text-foreground-muted mb-2">Missing Skills from Industry</h5>
            <div className="flex flex-wrap gap-2">
              {result.missingSkills.map((sk, i) => (
                <span key={i} className="text-[10px] font-bold uppercase bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                  {sk}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h5 className="text-[10px] uppercase font-bold text-foreground-muted">Improvement Suggestions</h5>
            <p className="text-foreground text-xs leading-relaxed">
              {result.formattingFeedback}
            </p>
            <ul className="space-y-1 pt-2">
              {result.improvementSuggestions.map((s, i) => (
                <li key={i} className="text-xs text-foreground-muted">
                  - {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="border-t border-border pt-6">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-4">
            Recent Analysis History
          </h4>
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="flex justify-between items-center p-3 bg-surface-raised rounded-xl text-xs">
                <div>
                  <span className="font-bold text-foreground">ATS Score: {h.atsScore}/100</span>
                  <span className="block text-[10px] text-foreground-muted mt-0.5">
                    {new Date(h.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-[550px]">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" /> AI Career Chatbot
        </h2>
        <p className="text-xs text-foreground-muted mt-1">
          Chat with a context-aware assistant loaded with your profile settings. Unrelated questions are filtered.
        </p>
      </div>

      <div className="flex-grow bg-background border border-border rounded-3xl p-4 overflow-y-auto space-y-4 flex flex-col justify-between">
        <div className="space-y-3 flex-grow overflow-y-auto pr-2">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl p-4 text-xs leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-surface-raised border border-border text-foreground shadow-sm"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface-raised border border-border text-foreground-muted rounded-2xl px-4 py-3 text-xs flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                <span>NEXORA Advisor is formulating advice...</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={sendMessage} className="mt-4 flex gap-2">
          <input
            type="text"
            placeholder="Ask anything about scholarships, resumes, careers..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-grow text-xs px-4 py-3 bg-surface-raised border border-border rounded-2xl outline-none focus:border-primary text-foreground transition-all"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-3 bg-primary hover:bg-primary-hover text-primary-foreground rounded-2xl shadow-sm transition-all disabled:opacity-60 flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
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
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> AI Technical Interview Coach
        </h2>
        <p className="text-xs text-foreground-muted mt-1">
          Simulate structured questions based on chosen roles and receive technical feedback summaries from Gemini.
        </p>
      </div>

      {stage === "setup" && (
        <div className="space-y-4 p-6 bg-surface-raised border border-border rounded-3xl">
          <div>
            <label className="block text-[10px] uppercase font-bold text-foreground-muted mb-2">
              Select Position Role
            </label>
            <select
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full text-xs px-3.5 py-3 bg-surface border border-border rounded-xl outline-none focus:border-primary transition-all"
            >
              <option value="Frontend Engineer">Frontend Engineer</option>
              <option value="Backend Engineer">Backend Engineer</option>
              <option value="Product Manager">Product Manager</option>
            </select>
          </div>

          <button
            onClick={startInterview}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold rounded-xl transition-all"
          >
            Begin Interview Session
          </button>
        </div>
      )}

      {stage === "interviewing" && questions.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center text-[10px] font-bold text-foreground-muted">
            <span>QUESTION {currentIdx + 1} OF {questions.length}</span>
            <span className="text-primary">{jobTitle} Interview</span>
          </div>

          <div className="p-5 bg-primary/30 border border-primary/10 rounded-2xl">
            <p className="text-foreground text-xs font-bold leading-relaxed">
              {questions[currentIdx]}
            </p>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-foreground-muted mb-2">
              Your Answer Response
            </label>
            <textarea
              rows={4}
              placeholder="Type your response to the question in detail..."
              value={answers[currentIdx]}
              onChange={(e) => {
                const updated = [...answers];
                updated[currentIdx] = e.target.value;
                setAnswers(updated);
              }}
              className="w-full text-xs p-4 bg-surface-raised border border-border rounded-2xl outline-none focus:bg-surface focus:border-primary resize-none"
            />
          </div>

          <button
            onClick={handleAnswerSubmit}
            disabled={!answers[currentIdx].trim()}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold rounded-xl transition-all disabled:opacity-60"
          >
            {currentIdx < questions.length - 1 ? "Next Question" : "Complete & Evaluate"}
          </button>
        </div>
      )}

      {stage === "feedback" && (
        <div className="space-y-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <span className="text-xs text-foreground-muted">Gemini is evaluating your responses...</span>
            </div>
          ) : (
            feedback && (
              <div className="space-y-5">
                <div className="p-5 bg-primary/30 border border-primary/10 rounded-2xl flex justify-between items-center">
                  <div>
                    <h4 className="text-foreground-muted text-[10px] font-bold uppercase tracking-wider">
                      Confidence & Tone Rating
                    </h4>
                    <span className="text-3xl font-black text-primary">{feedback.confidenceScore}/100</span>
                  </div>
                </div>

                <div className="bg-surface-raised p-4 rounded-2xl border border-border space-y-2">
                  <h5 className="text-[10px] uppercase font-bold text-foreground-muted">Technical Evaluation</h5>
                  <p className="text-foreground text-xs leading-relaxed">{feedback.technicalFeedback}</p>
                </div>

                <div className="bg-surface-raised p-4 rounded-2xl border border-border space-y-2">
                  <h5 className="text-[10px] uppercase font-bold text-foreground-muted">Communication & Structure</h5>
                  <p className="text-foreground text-xs leading-relaxed">{feedback.communicationFeedback}</p>
                </div>

                <div className="bg-surface-raised p-4 rounded-2xl border border-border space-y-2">
                  <h5 className="text-[10px] uppercase font-bold text-foreground-muted">Improvement Suggestions</h5>
                  <ul className="space-y-1">
                    {feedback.improvementSuggestions.map((s, i) => (
                      <li key={i} className="text-xs text-foreground">
                        - {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {feedback.followUpQuestions && feedback.followUpQuestions.length > 0 && (
                  <div className="bg-surface-raised p-4 rounded-2xl border border-border space-y-2">
                    <h5 className="text-[10px] uppercase font-bold text-foreground-muted">Follow-up Questions to Practice</h5>
                    <ul className="space-y-1">
                      {feedback.followUpQuestions.map((q, i) => (
                        <li key={i} className="text-xs text-foreground italic">
                          &quot;{q}&quot;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => setStage("setup")}
                  className="w-full py-3 border border-border hover:border-primary hover:text-primary text-foreground-muted text-xs font-bold rounded-xl transition-all"
                >
                  Start New Session
                </button>
              </div>
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

      // Generate Gemini tracking text
      const progressSummary = await AIServiceClient.trackConfidence(currentStats);
      setSummary(progressSummary);

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
      <div className="py-12 flex justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <LineChart className="w-5 h-5 text-primary" /> AI Performance & Analytics Dashboard
        </h2>
        <p className="text-xs text-foreground-muted mt-1">
          Overview metrics compiled from database rule actions, with monthly progress digests generated by Gemini.
        </p>
      </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Profile Integrity", value: `${stats.profileCompletion}%` },
            { label: "Latest ATS Score", value: `${stats.resumeScanScore}/100` },
            { label: "Document Performance", value: `${stats.performanceScore}/100` },
            { label: "Practice Interviews", value: stats.interviewSessionCount },
          ].map((stat, idx) => (
            <div key={idx} className="bg-surface-raised border border-border p-4 rounded-2xl">
              <span className="block text-[9px] font-bold uppercase text-foreground-muted">{stat.label}</span>
              <span className="text-lg font-black text-foreground mt-1 block">{stat.value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 bg-surface border border-border rounded-2xl flex-wrap">
          <p className="text-xs text-foreground-muted">
            Document Performance is calculated from your wallet documents — marksheets, certificates, awards,
            projects and resume. Add more documents and it moves on its own.
          </p>
          <Link
            href="/dashboard/performance"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            Open performance profile <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

      <div className="p-5 bg-primary/30 border border-primary/10 rounded-2xl flex flex-col md:flex-row items-start gap-4">
        <div className="p-3 bg-surface rounded-2xl border border-primary/10 text-primary shadow-sm">
          <TrendingUp className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Monthly AI Progress Summary (Gemini)
          </span>
          <p className="text-foreground text-xs leading-relaxed mt-2 whitespace-pre-line font-medium">
            {summary}
          </p>
        </div>
      </div>
    </div>
  );
}
