"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useOpportunities, formatDeadline } from "@/hooks/useOpportunities";
import {
  Search,
  Filter,
  Calendar,
  MapPin,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Sparkles,
  Compass,
  Loader2,
  ExternalLink,
  Zap,
  RefreshCw,
  X,
  Globe,
  Monitor,
  Building2,
  Banknote,
  Users,
  GraduationCap,
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "framer-motion";

const filterPanelVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: "easeOut", staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const filterFieldVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: "easeOut" } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15 } },
};

function SkeletonCard() {
  return (
    <div className="bg-surface border border-border rounded-3xl p-6 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="skeleton h-5 w-20 rounded-full" />
        <div className="skeleton h-7 w-7 rounded-full" />
      </div>
      <div className="skeleton h-4 w-4/5" />
      <div className="skeleton h-3 w-2/5" />
      <div className="space-y-2 mt-2">
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-3/5" />
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-3 w-16" />
      </div>
    </div>
  );
}

// ── Inference helpers for dynamic filtering (scrape all → filter client-side) ──

function inferMode(opp: any): "online" | "offline" | "hybrid" | "unknown" {
  const hay = `${opp.country || ""} ${opp.description || ""} ${opp.title || ""} ${opp.field || ""}`.toLowerCase();
  if (hay.includes("hybrid")) return "hybrid";
  if (hay.includes("online") || hay.includes("virtual") || hay.includes("remote") || opp.country === "Global") {
    // if explicitly says offline + online both → hybrid, already handled
    if (hay.includes("offline") || hay.includes("on-site") || hay.includes("onsite")) return "hybrid";
    return "online";
  }
  if (hay.includes("offline") || hay.includes("on-site") || hay.includes("onsite") || hay.includes("in-person") || hay.includes("campus")) return "offline";
  // default: Global = online, India locations = offline hint if not stated
  if (opp.country === "Global") return "online";
  return "unknown";
}

function inferCost(opp: any): "free" | "paid" | "unknown" {
  const hay = `${opp.description || ""} ${opp.title || ""} ${opp.eligibility || ""}`.toLowerCase();
  if (/free entry|no fee|free registration|free to join/i.test(hay)) return "free";
  if (/paid|registration fee|entry fee|₹\s*\d+|\$\s*\d+|fee:/i.test(hay)) return "paid";
  // hackathons are typically free
  if (opp.category === "Hackathons") return "free";
  return "unknown";
}

function inferWorkMode(opp: any): "remote" | "onsite" | "hybrid" | "unknown" {
  const hay = `${opp.country || ""} ${opp.description || ""} ${opp.title || ""}`.toLowerCase();
  if (hay.includes("work from home") || hay.includes("remote") || hay.includes("virtual")) {
    if (hay.includes("hybrid")) return "hybrid";
    return "remote";
  }
  if (hay.includes("hybrid")) return "hybrid";
  if (hay.includes("on-site") || hay.includes("onsite") || hay.includes("office")) return "onsite";
  if (opp.country === "India" && opp.category === "Internships") return "onsite";
  return "unknown";
}

function inferStipend(opp: any): "paid" | "unpaid" | "unknown" {
  const hay = `${opp.description || ""} ${opp.title || ""}`.toLowerCase();
  if (/unpaid|without stipend|no stipend/.test(hay)) return "unpaid";
  if (/stipend|paid|salary|₹\s*\d+/.test(hay)) return "paid";
  return "unknown";
}

function inferGender(opp: any): "girls" | "boys" | "all" {
  const hay = `${opp.title || ""} ${opp.description || ""} ${opp.eligibility || ""} ${opp.orgName || ""}`.toLowerCase();
  if (/girls|women only|female only|for women|for girls|she\s|her\s|women's/.test(hay)) return "girls";
  if (/boys|men only|male only/.test(hay)) return "boys";
  return "all";
}

function inferFunding(opp: any): "gov" | "private" | "ngo" | "university" | "unknown" {
  const hay = `${opp.orgName || ""} ${opp.organization || ""} ${opp.title || ""} ${opp.description || ""} ${opp.sourceUrl || ""}`.toLowerCase();
  if (/government|gov\.in|ministry|national |central gov|state gov|ugc|aicte|dst|daad|nsigse|kgbv|ssy|bbbp|vigyan jyoti|inspire|wise-kiran|serb power/.test(hay)) return "gov";
  if (/university|college|institute|iit|nit|aiims/.test(hay)) return "university";
  if (/ngo|trust|foundation|reliance foundation|azim premji|tata trust/.test(hay)) return "ngo";
  if (/private|corp|inc\.|ltd|company|buddy4study|unstop|internshala|devpost/.test(hay)) return "private";
  return "unknown";
}

function toSnapshot(opp: any) {
  return {
    id: opp.id,
    title: opp.title,
    organization: opp.organization || opp.orgName,
    orgName: opp.orgName || opp.organization,
    description: opp.description,
    eligibility: opp.eligibility,
    deadline: opp.deadline,
    country: opp.country,
    category: opp.category,
    field: opp.field,
    applyLink: opp.applyLink,
    sourceUrl: opp.sourceUrl,
    requiredDocuments: opp.requiredDocuments || [],
    _source: opp._source || opp.scraperName || "",
  };
}

function ExploreContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { opportunities, loading: oppsLoading } = useOpportunities();

  // Search & global filters
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("Hackathons");
  const [selectedField, setSelectedField] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedDegree, setSelectedDegree] = useState("");
  const [savedIds, setSavedIds] = useState<string[]>([]);

  // ── Category-wise dynamic filter state ──
  // Hackathon
  const [hackMode, setHackMode] = useState(""); // online | offline | hybrid
  const [hackCost, setHackCost] = useState(""); // free | paid
  // Internship / Jobs
  const [internWorkMode, setInternWorkMode] = useState(""); // remote | onsite | hybrid
  const [internStipend, setInternStipend] = useState(""); // paid | unpaid
  // Scholarship
  const [scholarGender, setScholarGender] = useState(""); // girls | boys | all
  const [scholarFunding, setScholarFunding] = useState(""); // gov | private | ngo | university
  // Fellowship (reuses scholarshipFunding + gender)
  const [fellowFunding, setFellowFunding] = useState("");
  const [fellowGender, setFellowGender] = useState("");
  // Conference
  const [confMode, setConfMode] = useState(""); // online | offline | hybrid

  // Live scrape
  const [liveOpps, setLiveOpps] = useState<any[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveError, setLiveError] = useState("");

  // Summarize popup modal
  const [selectedOpp, setSelectedOpp] = useState<any | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const fetchLive = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) { setLiveLoading(true); setLiveError(""); }
    try {
      const res = await fetch("/api/scrape?preview=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch live data");
      const mapped = (data.opportunities || []).map((o: any) => ({
        id: o.id || `opp-${(o.title || "item").slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title: o.title,
        organization: o.orgName || o.organization,
        orgName: o.orgName || o.organization,
        description: o.description,
        eligibility: o.eligibility,
        deadline: o.deadline,
        country: o.country,
        category: o.category,
        field: o.field,
        applyLink: o.applyLink,
        requiredDocuments: o.requiredDocuments || [],
        sourceUrl: o.sourceUrl,
        _live: true,
        _source: o.scraperName || o.sourceUrl,
      }));
      setLiveOpps(mapped);
      if (mapped.length > 0) setLiveEnabled(true);
      if (data.mode) console.log(`[explore] scrape mode=${data.mode} cached=${data.cached} count=${data.count}`);
    } catch (e: any) {
      if (!opts?.silent) setLiveError(e.message);
      else console.warn("[explore] silent fetch failed", e.message);
    } finally {
      if (!opts?.silent) setLiveLoading(false);
    }
  };

  // ── Solid local storage: auto-load cached data on first mount (no re-scrape, instant)
  // Storage is at storage/scraped-opportunities.json (400 cap), refreshed every 2 days via instrumentation.ts
  // and expiry pruned every 12h. This call hits /api/scrape?preview=1 which serves cached if <2 days old.
  useEffect(() => {
    fetchLive({ silent: true });
  }, []);

  const openSummarize = async (opp: any) => {
    const targetUrl = opp.sourceUrl || opp.applyLink;
    setSelectedOpp(opp);
    setModalOpen(true);
    setSummarizing(true);
    setSummaryError("");
    setSummaryText("");
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          title: opp.title,
          orgName: opp.organization || opp.orgName,
          category: opp.category,
          deadline: opp.deadline,
          country: opp.country,
          field: opp.field,
          eligibility: opp.eligibility,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Summarize failed");
      setSummaryText(data.summary || "No summary returned.");
    } catch (e: any) {
      setSummaryError(e.message);
    } finally {
      setSummarizing(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedOpp(null);
    setSummaryText("");
    setSummaryError("");
    setSummarizing(false);
  };

  // Bookmarks
  useEffect(() => {
    if (!currentUser) return;
    const fetchBookmarks = async () => {
      const snap = await getDoc(doc(db, "bookmarks", currentUser.uid));
      if (snap.exists()) setSavedIds(snap.data().opportunityIds || []);
    };
    fetchBookmarks();
  }, [currentUser]);

  const toggleBookmark = async (oppId: string, opp?: any) => {
    if (!currentUser) {
      router.push("/auth/login");
      return;
    }
    const docRef = doc(db, "bookmarks", currentUser.uid);
    const isBookmarked = savedIds.includes(oppId);
    try {
      const snap = await getDoc(docRef);
      const existing = snap.exists() ? snap.data() : { opportunityIds: [], items: [] };
      const ids: string[] = Array.isArray(existing.opportunityIds) ? existing.opportunityIds : [];
      const items: any[] = existing.items && Array.isArray(existing.items) ? existing.items : [];
      let nextIds: string[];
      let nextItems: any[];
      if (isBookmarked) {
        nextIds = ids.filter((i) => i !== oppId);
        nextItems = items.filter((it: any) => it?.id !== oppId);
      } else {
        const resolved = opp || mergedOpportunities.find((o: any) => o.id === oppId);
        nextIds = [...ids, oppId];
        nextItems = [
          ...items.filter((it: any) => it?.id !== oppId),
          ...(resolved ? [toSnapshot(resolved)] : []),
        ];
      }
      await setDoc(docRef, { opportunityIds: nextIds, items: nextItems });
      setSavedIds(nextIds);
    } catch (error) {
      console.error("Bookmarking error:", error);
    }
  };

  // Merge Firestore + live (dedup by title)
  const mergedOpportunities = (() => {
    if (!liveEnabled || liveOpps.length === 0) return opportunities as any[];
    const seen = new Set(opportunities.map((o) => o.title.toLowerCase().trim()));
    const filteredLive = liveOpps.filter((o: any) => !seen.has(o.title.toLowerCase().trim()));
    return [...(opportunities as any[]), ...filteredLive];
  })();

  // Active filter count for badge
  const activeFilterCount = [
    selectedField, selectedCountry, selectedDegree,
    hackMode, hackCost, internWorkMode, internStipend,
    scholarGender, scholarFunding, fellowGender, fellowFunding, confMode,
  ].filter(Boolean).length + (searchQuery.trim() ? 1 : 0);

  const resetAll = () => {
    setSearchQuery("");
    setSelectedField(""); setSelectedCountry(""); setSelectedDegree("");
    setHackMode(""); setHackCost(""); setInternWorkMode(""); setInternStipend("");
    setScholarGender(""); setScholarFunding(""); setFellowGender(""); setFellowFunding(""); setConfMode("");
  };

  // Filter logic — NO pre-filtering at scrape time; all filtering is client-side here
  const filteredOpportunities = mergedOpportunities.filter((opp: any) => {
    // Search (title/org/desc/field/category)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${opp.title} ${opp.organization || opp.orgName || ""} ${opp.description} ${opp.category} ${opp.field} ${opp.country}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (selectedCategory && opp.category !== selectedCategory) return false;
    if (selectedField && opp.field?.toLowerCase() !== selectedField.toLowerCase()) return false;
    if (selectedCountry && opp.country?.toLowerCase() !== selectedCountry.toLowerCase()) return false;
    if (selectedDegree && (opp as any).degreeLevel && (opp as any).degreeLevel !== selectedDegree) return false;

    // Category-wise extra filters (only apply when that category is either selected or the opp belongs to it)
    if (opp.category === "Hackathons" || selectedCategory === "Hackathons") {
      if (hackMode) {
        const m = inferMode(opp);
        if (m !== "unknown" && m !== hackMode) return false;
        if (m === "unknown" && hackMode !== "") {
          // if unknown, don't hide — let it show (so scraping "all" doesn't hide data)
        }
      }
      if (hackCost) {
        const c = inferCost(opp);
        if (c !== "unknown" && c !== hackCost) return false;
      }
    }
    if (opp.category === "Internships") {
      if (internWorkMode) {
        const wm = inferWorkMode(opp);
        if (wm !== "unknown" && wm !== internWorkMode) return false;
      }
      if (internStipend) {
        const st = inferStipend(opp);
        if (st !== "unknown" && st !== internStipend) return false;
      }
    }
    if (opp.category === "Scholarships") {
      if (scholarGender && scholarGender !== "all") {
        const g = inferGender(opp);
        // "all" tagged opps are visible for any gender filter (since they are open to all)
        if (g !== "all" && g !== scholarGender) return false;
        // if filter is girls, show only girls + all
        if (scholarGender === "girls" && g === "boys") return false;
        if (scholarGender === "boys" && g === "girls") return false;
      }
      if (scholarFunding) {
        const f = inferFunding(opp);
        if (f !== "unknown" && f !== scholarFunding) return false;
      }
    }
    if (opp.category === "Fellowships") {
      if (fellowGender && fellowGender !== "all") {
        const g = inferGender(opp);
        if (g !== "all" && g !== fellowGender) return false;
        if (fellowGender === "girls" && g === "boys") return false;
        if (fellowGender === "boys" && g === "girls") return false;
      }
      if (fellowFunding) {
        const f = inferFunding(opp);
        if (f !== "unknown" && f !== fellowFunding) return false;
      }
    }
    if (opp.category === "Conferences") {
      if (confMode) {
        const m = inferMode(opp);
        if (m !== "unknown" && m !== confMode) return false;
      }
    }
    return true;
  });

  const selectClass = "w-full text-xs px-3.5 py-2.5 bg-surface-raised border border-border rounded-xl outline-none focus:bg-surface focus:border-primary text-foreground transition-all";

  // Dynamic placeholder for search bar based on category
  const searchPlaceholder =
    selectedCategory === "Hackathons" ? "Search hackathons — e.g. Smart India Hackathon, prize, online..." :
    selectedCategory === "Internships" ? "Search internships — e.g. Google, remote, stipend..." :
    selectedCategory === "Scholarships" ? "Search scholarships — e.g. for girls, government, merit..." :
    selectedCategory === "Fellowships" ? "Search fellowships — e.g. research, DAAD, women..." :
    selectedCategory === "Conferences" ? "Search conferences — e.g. IEEE, CFP, virtual..." :
    "Search by keywords — e.g. Google, Fellowship, Science, hackathon, remote...";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Title row */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="w-3.5 h-3.5" /> Explore
            </span>
            <h1 className="text-3xl font-extrabold text-foreground mt-1">Find Opportunities</h1>
              <p className="text-sm text-foreground-muted mt-1">
                Hackathons, internships, scholarships and more — all in one place.
              </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchLive()}
              disabled={liveLoading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl border border-border bg-surface hover:border-primary hover:text-primary transition-all disabled:opacity-50"
            >
              {liveLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {liveLoading ? "Refreshing..." : "Refresh"}
            </button>
            {liveOpps.length > 0 && (
              <button
                onClick={() => setLiveEnabled((v) => !v)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl border transition-all ${liveEnabled ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-foreground-muted hover:border-primary"}`}
              >
                <Zap className="w-3.5 h-3.5" />
                Live: {liveEnabled ? "ON" : "OFF"} ({liveOpps.length})
              </button>
            )}
          </div>
        </div>
        {liveError && <p className="text-xs text-red-500 mt-2">{liveError}</p>}
      </div>

      {/* ── Prominent global search bar ── */}
      <motion.div
        animate={{
          scale: searchFocused ? 1.01 : 1,
          boxShadow: searchFocused
            ? "0 0 0 3px var(--accent-glow), 0 8px 20px -8px rgba(178, 58, 92, 0.25)"
            : "0 1px 2px rgba(0,0,0,0.04)",
          borderColor: searchFocused ? "var(--primary)" : "var(--border)",
        }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex bg-surface rounded-2xl border p-2 mb-6 shadow-sm"
      >
        <div className="flex items-center flex-grow pl-3 gap-2">
          <motion.span
            animate={{
              scale: searchFocused ? 1.15 : 1,
              color: searchFocused ? "var(--primary)" : "var(--foreground-muted)",
            }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 flex"
          >
            <Search className="w-5 h-5" />
          </motion.span>
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full text-sm outline-none text-foreground bg-transparent placeholder-foreground-muted"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="p-1.5 rounded-full hover:bg-surface-raised text-foreground-muted hover:text-foreground mr-1">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => {}}
          className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold bg-primary text-primary-foreground px-6 py-2.5 rounded-xl hover:bg-primary/90 transition-colors ml-2"
        >
          <Search className="w-3.5 h-3.5" /> Search
        </button>
      </motion.div>

      {/* ── Category buttons (horizontal, below search bar) ── */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { key: "Hackathons", label: "Hackathons" },
          { key: "Internships", label: "Internships" },
          { key: "Scholarships", label: "Scholarships" },
          { key: "Conferences", label: "Conferences" },
          { key: "Fellowships", label: "Fellowships" },
        ].map((c) => {
          const isActive = selectedCategory === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setSelectedCategory(c.key)}
              className={`text-[11px] font-[700] tracking-[0.04em] uppercase px-4 py-2 rounded-full border transition-all ${isActive ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface border-border text-foreground-muted hover:border-primary hover:text-primary"}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 min-h-[calc(100vh-7rem)]">
        {/* ── Left: Self-adjustable filter panel (changes per category) ── */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={filterPanelVariants}
          className="lg:col-span-1 bg-surface border border-border rounded-3xl p-6 shadow-sm h-full max-h-[calc(100vh-7rem)] overflow-y-auto transition-colors duration-300 lg:sticky lg:top-20"
        >
          <motion.div variants={filterFieldVariants} className="flex items-center justify-between mb-6 pb-4 border-b border-border">
            <span className="flex items-center gap-2 font-bold text-foreground">
              <Filter className="w-4 h-4 text-primary" /> Filters
            </span>
            {activeFilterCount > 0 && <span className="text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">{activeFilterCount}</span>}
          </motion.div>

          <div className="space-y-5">
            {/* ── Hackathon filters ── */}
            {selectedCategory === "Hackathons" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <Monitor className="w-3 h-3" /> Mode
                  </label>
                  <select value={hackMode} onChange={(e) => setHackMode(e.target.value)} className={selectClass}>
                    <option value="">Any mode</option>
                    <option value="online">Online</option>
                    <option value="offline">In person</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <Banknote className="w-3 h-3" /> Entry Fee
                  </label>
                  <select value={hackCost} onChange={(e) => setHackCost(e.target.value)} className={selectClass}>
                    <option value="">Any</option>
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                </motion.div>
              </>
            )}

            {/* ── Internship filters ── */}
            {selectedCategory === "Internships" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <Building2 className="w-3 h-3" /> Work Mode
                  </label>
                  <select value={internWorkMode} onChange={(e) => setInternWorkMode(e.target.value)} className={selectClass}>
                    <option value="">Any</option>
                    <option value="remote">Work from home</option>
                    <option value="onsite">In office</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <Banknote className="w-3 h-3" /> Stipend
                  </label>
                  <select value={internStipend} onChange={(e) => setInternStipend(e.target.value)} className={selectClass}>
                    <option value="">Any</option>
                    <option value="paid">Paid</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </motion.div>
              </>
            )}

            {/* ── Scholarship filters ── */}
            {selectedCategory === "Scholarships" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <Users className="w-3 h-3" /> For Whom
                  </label>
                  <select value={scholarGender} onChange={(e) => setScholarGender(e.target.value)} className={selectClass}>
                    <option value="">Anyone</option>
                    <option value="girls">Girls / Women</option>
                    <option value="boys">Boys</option>
                    <option value="all">Open to all</option>
                  </select>
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <GraduationCap className="w-3 h-3" /> Funding By
                  </label>
                  <select value={scholarFunding} onChange={(e) => setScholarFunding(e.target.value)} className={selectClass}>
                    <option value="">Any</option>
                    <option value="gov">Government</option>
                    <option value="private">Company</option>
                    <option value="ngo">NGO / Trust</option>
                    <option value="university">University</option>
                  </select>
                </motion.div>
              </>
            )}

            {/* ── Fellowship filters ── */}
            {selectedCategory === "Fellowships" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <Users className="w-3 h-3" /> For Whom
                  </label>
                  <select value={fellowGender} onChange={(e) => setFellowGender(e.target.value)} className={selectClass}>
                    <option value="">Anyone</option>
                    <option value="girls">Girls / Women</option>
                    <option value="boys">Boys</option>
                    <option value="all">Open to all</option>
                  </select>
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                    <GraduationCap className="w-3 h-3" /> Funding By
                  </label>
                  <select value={fellowFunding} onChange={(e) => setFellowFunding(e.target.value)} className={selectClass}>
                    <option value="">Any</option>
                    <option value="gov">Government</option>
                    <option value="private">Company</option>
                    <option value="ngo">NGO / Trust</option>
                    <option value="university">University</option>
                  </select>
                </motion.div>
              </>
            )}

            {/* ── Conference filters ── */}
            {selectedCategory === "Conferences" && (
              <motion.div variants={filterFieldVariants}>
                <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                  <Globe className="w-3 h-3" /> Mode
                </label>
                <select value={confMode} onChange={(e) => setConfMode(e.target.value)} className={selectClass}>
                  <option value="">Any mode</option>
                  <option value="online">Online</option>
                  <option value="offline">In person</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </motion.div>
            )}

            <motion.button variants={filterFieldVariants} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={resetAll} className="w-full text-xs text-center border border-border hover:border-primary hover:text-primary py-2.5 rounded-xl transition-all font-semibold text-foreground-muted hover:bg-primary/5">
              Clear filters
            </motion.button>
          </div>
        </motion.div>

        {/* Right Grid */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 text-foreground-muted text-xs font-medium">
            <span>
              {oppsLoading ? "Loading opportunities..." : `Showing ${filteredOpportunities.length} opportunities${liveEnabled && liveOpps.length > 0 ? ` (incl. ${liveOpps.length} live)` : ""}`}
              {!oppsLoading && filteredOpportunities.length > 0 && activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`}
            </span>
            {!oppsLoading && liveEnabled && liveOpps.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> Live: Devpost • Unstop • Internshala • Conf • Fellow
              </span>
            )}
          </div>

          {oppsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: 4 }).map((_, i) => (<SkeletonCard key={i} />))}
            </div>
          ) : (
            <motion.div initial="hidden" animate="show" variants={gridVariants} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AnimatePresence>
                {filteredOpportunities.map((opp: any) => {
                  const isSaved = savedIds.includes(opp.id);
                  const isLive = !!opp._live;
                  const applyLink: string = opp.applyLink || "";
                  const hrefId = isLive ? undefined : `/opportunity/${opp.id}`;
                    return (
                    <motion.div key={opp.id} layout variants={cardVariants} initial="hidden" animate="show" exit="exit" className={`bg-surface border rounded-3xl p-6 shadow-sm hover:shadow-md dark:hover:shadow-[0_4px_20px_rgba(255,60,110,0.12)] hover:border-primary/25 transition-all flex flex-col justify-between card-hover cursor-pointer ${isLive ? "border-emerald-200 dark:border-emerald-900/40" : "border-border"}`} onClick={() => openSummarize(opp)}>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-2.5 py-1 rounded-full">{opp.category}</span>
                            {isLive && (<span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-500 text-white px-2 py-0.5 rounded-full flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Live</span>)}
                            {opp._source && isLive && (<span className="text-[10px] text-foreground-muted font-medium">{opp._source}</span>)}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); toggleBookmark(opp.id, opp); }} title={isSaved ? "Saved" : "Save"} className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${isSaved ? "bg-primary/10 text-primary" : "bg-surface-raised text-foreground-muted hover:text-primary hover:bg-primary/8"}`}>
                            {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                          </button>
                        </div>
                        <h3 className="font-bold text-foreground text-base leading-snug hover:text-primary transition-colors">
                          <span>{opp.title}</span>
                        </h3>
                        <p className="text-foreground-muted text-xs mt-1 font-medium">{opp.organization || opp.orgName}</p>
                        <p className="text-foreground-muted text-xs mt-4 leading-relaxed line-clamp-3">{opp.description}</p>
                        <p className="text-[10px] font-semibold text-primary mt-3 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Tap for an AI summary</p>
                      </div>
                      <div className="border-t border-border mt-4 pt-4 space-y-3">
                        <div className="flex items-center gap-4 text-[11px] text-foreground-muted flex-wrap">
                          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-foreground-muted" />{opp.country}</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-foreground-muted" />{formatDeadline(opp.deadline)}</span>
                          {opp.field && <span className="inline-flex items-center gap-1 bg-surface-raised px-2 py-0.5 rounded-full text-[10px] font-semibold">{opp.field}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={(e) => { e.stopPropagation(); openSummarize(opp); }} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-primary text-primary-foreground px-4 py-2.5 rounded-xl hover:bg-primary/90 transition-colors"><Sparkles className="w-3.5 h-3.5" /> AI Summary</button>
                          {applyLink ? (
                            <a href={applyLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center gap-1.5 text-xs font-bold border border-border bg-surface px-4 py-2.5 rounded-xl hover:border-primary hover:text-primary transition-colors">Apply <ExternalLink className="w-3.5 h-3.5" /></a>
                          ) : hrefId ? (
                            <Link href={hrefId} onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center gap-1 text-xs font-bold border border-border bg-surface px-4 py-2.5 rounded-xl hover:border-primary hover:text-primary transition-colors">Details <ChevronRight className="w-3.5 h-3.5" /></Link>
                          ) : null}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}

          {!oppsLoading && filteredOpportunities.length === 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }} className="text-center py-20 bg-surface border border-border rounded-3xl transition-colors">
              <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} className="inline-flex">
                <Compass className="w-12 h-12 text-foreground-muted mx-auto mb-4 opacity-50" />
              </motion.div>
              <h4 className="text-foreground font-bold mb-1">No opportunities found</h4>
              <p className="text-foreground-muted text-xs">Try clearing filters or searching with fewer keywords.</p>
              {activeFilterCount > 0 && (<button onClick={resetAll} className="mt-4 text-xs font-bold bg-primary text-primary-foreground px-5 py-2.5 rounded-xl hover:bg-primary/90">Reset all filters</button>)}
            </motion.div>
          )}
        </div>
      </div>

      {/* ── AI Full-Summarize Popup Modal ── */}
      <AnimatePresence>
        {modalOpen && selectedOpp && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="bg-surface border border-border rounded-3xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col pointer-events-auto overflow-hidden">
                <div className="flex items-start justify-between gap-4 p-6 border-b border-border flex-shrink-0">
                  <div className="flex-1 min-w-0">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-2.5 py-1 rounded-full mb-2">{selectedOpp.category}</span>
                    <h3 className="font-bold text-foreground text-lg leading-snug line-clamp-2">{selectedOpp.title}</h3>
                    <p className="text-xs text-foreground-muted mt-1">{selectedOpp.organization || selectedOpp.orgName} • {selectedOpp.country}</p>
                    <a href={selectedOpp.sourceUrl || selectedOpp.applyLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2 break-all">{(selectedOpp.sourceUrl || selectedOpp.applyLink || "").slice(0, 80)} <ExternalLink className="w-3 h-3 flex-shrink-0" /></a>
                  </div>
                  <button onClick={closeModal} className="p-2 rounded-full hover:bg-surface-raised text-foreground-muted hover:text-foreground flex-shrink-0"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {summarizing ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      <p className="text-sm font-semibold text-foreground">Full scraping page...</p>
                      <p className="text-xs text-foreground-muted text-center">Fetching full content and summarizing via OpenRouter key 1 into easy format.<br />Main facts will appear at the end.</p>
                    </div>
                  ) : summaryError ? (
                    <div className="bg-red-500/10 border border-red-200 rounded-xl p-4">
                      <p className="text-sm font-semibold text-red-600">Failed to summarize</p>
                      <p className="text-xs text-red-500 mt-1">{summaryError}</p>
                      <button onClick={() => openSummarize(selectedOpp)} className="mt-3 text-xs font-bold bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600">Retry</button>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground-muted prose-strong:text-foreground prose-li:text-foreground-muted prose-a:text-primary">
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground break-words">{summaryText}</pre>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 p-4 border-t border-border bg-surface-raised/50 flex-shrink-0">
                  <span className="text-[10px] text-foreground-muted">AI via OpenRouter key 1 (easy format • main facts at end)</span>
                  <div className="flex items-center gap-2">
                    <button onClick={closeModal} className="text-xs font-semibold px-4 py-2 rounded-xl border border-border hover:border-foreground text-foreground-muted hover:text-foreground">Close</button>
                    {selectedOpp.applyLink && <a href={selectedOpp.applyLink} target="_blank" rel="noopener noreferrer" className="text-xs font-bold bg-primary text-primary-foreground px-5 py-2.5 rounded-xl hover:bg-primary/90 inline-flex items-center gap-1.5">Apply Now <ExternalLink className="w-3.5 h-3.5" /></a>}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Explore() {
  return (
    <>
      <Navbar />
      <main className="flex-grow bg-background min-h-screen transition-colors duration-300">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>}>
          <ExploreContent />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
