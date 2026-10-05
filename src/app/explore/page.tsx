"use client";

import { useEffect, useState, Suspense, type ReactNode } from "react";
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
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { seedOpportunityNotification } from "@/lib/automationEngine";
import { authedFetch } from "@/lib/apiClient";

const CATEGORY_TABS = [
  { key: "Hackathons", label: "Hackathons" },
  { key: "Internships", label: "Internships" },
  { key: "Scholarships", label: "Scholarships" },
  { key: "Conferences", label: "Conferences" },
  { key: "Fellowships", label: "Fellowships" },
];

/* The filter rail rebuilds itself per category, but the underlying option sets are
   fixed. Hoisting them keeps each <Select> to a single line and stops the same
   four "Any / Online / In person / Hybrid" options being retyped per category. */
const MODE_OPTIONS = [
  { value: "", label: "Any mode" },
  { value: "online", label: "Online" },
  { value: "offline", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];
const COST_OPTIONS = [
  { value: "", label: "Any" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
];
const WORK_MODE_OPTIONS = [
  { value: "", label: "Any" },
  { value: "remote", label: "Work from home" },
  { value: "onsite", label: "In office" },
  { value: "hybrid", label: "Hybrid" },
];
const STIPEND_OPTIONS = [
  { value: "", label: "Any" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
];
const WHOM_OPTIONS = [
  { value: "", label: "Anyone" },
  { value: "girls", label: "Girls / Women" },
  { value: "boys", label: "Boys" },
  { value: "all", label: "Open to all" },
];
const FUNDING_OPTIONS = [
  { value: "", label: "Any" },
  { value: "gov", label: "Government" },
  { value: "private", label: "Company" },
  { value: "ngo", label: "NGO / Trust" },
  { value: "university", label: "University" },
];

/** The rail's field labels are all `Mode` / `Stipend` / `For Whom`-style words, so
    without the leading icon four adjacent <Select>s read as an undifferentiated
    stack. `.eyebrow` is display:block, hence the explicit inline alignment. */
function FilterLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <Icon className="mr-1 inline-block h-3 w-3 align-[-1px]" />
      {children}
    </>
  );
}

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
    <Card className="flex flex-col gap-4 p-6">
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
    </Card>
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
    if (!currentUser) {
      // The endpoint now requires a verified token; do not spend a round trip
      // on a guaranteed 401.
      setSelectedOpp(opp);
      setModalOpen(true);
      setSummarizing(false);
      setSummaryText("");
      setSummaryError("Sign in to get an AI summary of this opportunity.");
      return;
    }
    setSelectedOpp(opp);
    setModalOpen(true);
    setSummarizing(true);
    setSummaryError("");
    setSummaryText("");
    try {
      const res = await authedFetch("/api/summarize", {
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
      if (typeof data.summary !== "string" || !data.summary.trim()) {
        throw new Error("The AI did not return a summary for this opportunity.");
      }
      setSummaryText(data.summary);
    } catch (e: any) {
      setSummaryError(e.message || "Could not summarize this opportunity.");
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
        // Fire save + deadline notifications for this newly bookmarked opportunity
        if (resolved?.deadline && resolved?.title) {
          seedOpportunityNotification(
            currentUser.uid,
            oppId,
            resolved.title,
            resolved.deadline
          ).catch((e) => console.warn("Notification seed failed:", e));
        }
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
            <span className="eyebrow text-primary">
              <Sparkles className="mr-1 inline-block h-3.5 w-3.5 align-[-1px]" /> Explore
            </span>
            <h1 className="mt-1 font-display text-display-sm text-foreground">Find Opportunities</h1>
            <p className="mt-1 text-sm text-foreground-muted text-pretty">
              Hackathons, internships, scholarships and more — all in one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => fetchLive()}
              disabled={liveLoading}
              leadingIcon={
                liveLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )
              }
            >
              {liveLoading ? "Refreshing…" : "Refresh"}
            </Button>
            {liveOpps.length > 0 && (
              <Button
                type="button"
                variant={liveEnabled ? "primary" : "secondary"}
                aria-pressed={liveEnabled}
                onClick={() => setLiveEnabled((v) => !v)}
                leadingIcon={<Zap className="h-3.5 w-3.5" />}
              >
                Live: {liveEnabled ? "ON" : "OFF"} ({liveOpps.length})
              </Button>
            )}
          </div>
        </div>
        {liveError && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {liveError}
          </p>
        )}
      </div>

      {/* ── Prominent global search bar ── */}
      {/* The focus ring moved from an animated box-shadow to `ring-primary`. The
          old shadow interpolated from `var(--accent-glow)`, a token that does not
          exist in globals.css, so the whole declaration was dropped as invalid
          and the bar never actually glowed. Search itself is already live via
          onChange, so the button just commits/blurs instead of doing nothing. */}
      <motion.form
        onSubmit={(e) => {
          e.preventDefault();
          setSearchFocused(false);
        }}
        animate={{ scale: searchFocused ? 1.01 : 1, borderColor: searchFocused ? "var(--primary)" : "var(--border)" }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`card mb-6 flex p-2 ${searchFocused ? "ring-2 ring-primary/35" : ""}`}
      >
        <div className="flex grow items-center gap-2 pl-3">
          <motion.span
            animate={{
              scale: searchFocused ? 1.15 : 1,
              color: searchFocused ? "var(--primary)" : "var(--foreground-muted)",
            }}
            transition={{ duration: 0.2 }}
            className="flex shrink-0"
          >
            <Search className="h-5 w-5" />
          </motion.span>
          <input
            type="search"
            aria-label="Search opportunities"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder-foreground-muted"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="mr-1 grid h-7 w-7 place-items-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" className="ml-2 hidden sm:inline-flex" leadingIcon={<Search className="h-3.5 w-3.5" />}>
          Search
        </Button>
      </motion.form>

      {/* ── Category buttons (horizontal, below search bar) ── */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CATEGORY_TABS.map((c) => {
          const isActive = selectedCategory === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setSelectedCategory(c.key)}
              className={`btn btn-sm rounded-full ${isActive ? "btn-primary" : "btn-secondary"}`}
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
          className="lg:col-span-1 lg:sticky lg:top-20 h-full max-h-[calc(100vh-7rem)]"
        >
        <Card className="h-full max-h-[inherit] space-y-5 overflow-y-auto p-6">
          <motion.div variants={filterFieldVariants} className="mb-6 flex items-center justify-between border-b border-border pb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Filter className="h-4 w-4 text-primary" /> Filters
            </h2>
            {activeFilterCount > 0 && <Chip tone="gold">{activeFilterCount}</Chip>}
          </motion.div>

          {/* ── Hackathon filters ── */}
          {selectedCategory === "Hackathons" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={Monitor}>Mode</FilterLabel>}
                    value={hackMode}
                    onChange={(e) => setHackMode(e.target.value)}
                    options={MODE_OPTIONS}
                  />
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={Banknote}>Entry Fee</FilterLabel>}
                    value={hackCost}
                    onChange={(e) => setHackCost(e.target.value)}
                    options={COST_OPTIONS}
                  />
                </motion.div>
              </>
            )}

            {/* ── Internship filters ── */}
            {selectedCategory === "Internships" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={Building2}>Work Mode</FilterLabel>}
                    value={internWorkMode}
                    onChange={(e) => setInternWorkMode(e.target.value)}
                    options={WORK_MODE_OPTIONS}
                  />
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={Banknote}>Stipend</FilterLabel>}
                    value={internStipend}
                    onChange={(e) => setInternStipend(e.target.value)}
                    options={STIPEND_OPTIONS}
                  />
                </motion.div>
              </>
            )}

            {/* ── Scholarship filters ── */}
            {selectedCategory === "Scholarships" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={Users}>For Whom</FilterLabel>}
                    value={scholarGender}
                    onChange={(e) => setScholarGender(e.target.value)}
                    options={WHOM_OPTIONS}
                  />
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={GraduationCap}>Funding By</FilterLabel>}
                    value={scholarFunding}
                    onChange={(e) => setScholarFunding(e.target.value)}
                    options={FUNDING_OPTIONS}
                  />
                </motion.div>
              </>
            )}

            {/* ── Fellowship filters ── */}
            {selectedCategory === "Fellowships" && (
              <>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={Users}>For Whom</FilterLabel>}
                    value={fellowGender}
                    onChange={(e) => setFellowGender(e.target.value)}
                    options={WHOM_OPTIONS}
                  />
                </motion.div>
                <motion.div variants={filterFieldVariants}>
                  <Select
                    label={<FilterLabel icon={GraduationCap}>Funding By</FilterLabel>}
                    value={fellowFunding}
                    onChange={(e) => setFellowFunding(e.target.value)}
                    options={FUNDING_OPTIONS}
                  />
                </motion.div>
              </>
            )}

            {/* ── Conference filters ── */}
            {selectedCategory === "Conferences" && (
              <motion.div variants={filterFieldVariants}>
                <Select
                  label={<FilterLabel icon={Globe}>Mode</FilterLabel>}
                  value={confMode}
                  onChange={(e) => setConfMode(e.target.value)}
                  options={MODE_OPTIONS}
                />
              </motion.div>
            )}

            <motion.div variants={filterFieldVariants}>
              <Button type="button" variant="secondary" block onClick={resetAll}>
                Clear filters
              </Button>
            </motion.div>
          </Card>
        </motion.div>

        {/* Right Grid */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-foreground-muted">
            <span>
              {oppsLoading ? "Loading opportunities…" : `Showing ${filteredOpportunities.length} opportunities${liveEnabled && liveOpps.length > 0 ? ` (incl. ${liveOpps.length} live)` : ""}`}
              {!oppsLoading && filteredOpportunities.length > 0 && activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`}
            </span>
            {!oppsLoading && liveEnabled && liveOpps.length > 0 && (
              <Chip
                tone="success"
                icon={
                  <motion.span
                    animate={{ opacity: [1, 0.35, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                    className="block h-1.5 w-1.5 rounded-full bg-success"
                  />
                }
              >
                Live: Devpost • Unstop • Internshala • Conf • Fellow
              </Chip>
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
                    <motion.div
                      key={opp.id}
                      layout
                      variants={cardVariants}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      className="flex"
                    >
                    {/* The whole card opens the AI summary, so `interactive` is honest
                        here. Its old `card-hover` class does not exist in globals.css
                        and its `dark:hover:shadow-[…rgba(255,60,110,…)]` was a hardcoded
                        crimson glow that ignored the theme and only appeared in dark. */}
                    <Card
                      interactive
                      onClick={() => openSummarize(opp)}
                      className={`flex w-full flex-col justify-between p-6 ${isLive ? "border-success/40" : ""}`}
                    >
                      <div>
                        <div className="mb-4 flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip tone="gold">{opp.category}</Chip>
                            {isLive && (
                              <Chip tone="success" icon={<Zap className="h-2.5 w-2.5" />}>
                                Live
                              </Chip>
                            )}
                            {opp._source && isLive && (
                              <span className="text-2xs font-medium text-foreground-muted">{opp._source}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleBookmark(opp.id, opp); }}
                            title={isSaved ? "Saved" : "Save"}
                            aria-label={isSaved ? `Remove ${opp.title} from saved` : `Save ${opp.title}`}
                            aria-pressed={isSaved}
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors ${isSaved ? "bg-accent-gold-surface text-primary" : "bg-surface-raised text-foreground-muted hover:bg-accent-gold-surface hover:text-primary"}`}
                          >
                            {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                          </button>
                        </div>
                        <h3 className="text-base font-semibold leading-snug text-foreground">{opp.title}</h3>
                        <p className="mt-1 text-xs font-medium text-foreground-muted">{opp.organization || opp.orgName}</p>
                        <p className="mt-4 line-clamp-3 text-xs leading-relaxed text-foreground-muted">{opp.description}</p>
                        <p className="mt-3 flex items-center gap-1 text-2xs font-semibold text-secondary">
                          <Sparkles className="h-3 w-3" /> Tap for an AI summary
                        </p>
                      </div>
                      <div className="mt-4 space-y-3 border-t border-border pt-4">
                        <div className="flex flex-wrap items-center gap-4 text-2xs text-foreground-muted">
                          <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{opp.country}</span>
                          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDeadline(opp.deadline)}</span>
                          {opp.field && <Chip>{opp.field}</Chip>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="grow"
                            onClick={(e) => { e.stopPropagation(); openSummarize(opp); }}
                            leadingIcon={<Sparkles className="h-3.5 w-3.5" />}
                          >
                            AI Summary
                          </Button>
                          {applyLink ? (
                            <a
                              href={applyLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="btn btn-sm btn-secondary"
                            >
                              Apply <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : hrefId ? (
                            <Link href={hrefId} onClick={(e) => e.stopPropagation()} className="btn btn-sm btn-secondary">
                              Details <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}

          {!oppsLoading && filteredOpportunities.length === 0 && (
            <EmptyState
              icon={<Compass className="h-5 w-5" />}
              title="No opportunities found"
              description="Try clearing filters or searching with fewer keywords."
              action={
                activeFilterCount > 0 ? (
                  <Button type="button" variant="secondary" onClick={resetAll}>
                    Reset all filters
                  </Button>
                ) : undefined
              }
              className="border-0 bg-transparent py-16"
            />
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
              <Card tone="raised" role="dialog" aria-modal="true" aria-label={`AI summary of ${selectedOpp.title}`} className="pointer-events-auto flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-0">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-6">
                  <div className="min-w-0 flex-1">
                    <Chip tone="gold" className="mb-2">{selectedOpp.category}</Chip>
                    <h2 className="line-clamp-2 font-display text-lg leading-snug text-foreground">{selectedOpp.title}</h2>
                    <p className="mt-1 text-xs text-foreground-muted">{selectedOpp.organization || selectedOpp.orgName} • {selectedOpp.country}</p>
                    <a href={selectedOpp.sourceUrl || selectedOpp.applyLink} target="_blank" rel="noopener noreferrer" className="link-ink mt-2 inline-flex items-center gap-1 break-all text-xs">{(selectedOpp.sourceUrl || selectedOpp.applyLink || "").slice(0, 80)} <ExternalLink className="h-3 w-3 shrink-0" /></a>
                  </div>
                  <Button type="button" variant="quiet" size="icon" onClick={closeModal} aria-label="Close summary" className="shrink-0">
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {summarizing ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm font-semibold text-foreground">Full scraping page…</p>
                      <p className="text-center text-xs text-foreground-muted">Fetching full content and summarizing via OpenRouter key 1 into easy format.<br />Main facts will appear at the end.</p>
                    </div>
                  ) : summaryError ? (
                    <ErrorState
                      title="Failed to summarize"
                      description={summaryError}
                      action={
                        <Button type="button" size="sm" onClick={() => openSummarize(selectedOpp)}>
                          Retry
                        </Button>
                      }
                    />
                  ) : (
                    /* The summary renders inside a <pre>, so the `prose`/`prose-*`
                       classes this wrapper used were dead — @tailwindcss/typography
                       is not installed, so every one of them resolved to nothing. */
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">{summaryText}</pre>
                  )}
                </div>
<div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface-raised/50 p-4">
                  <span className="text-2xs text-foreground-muted">AI via OpenRouter key 1 (easy format • main facts at end)</span>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={closeModal}>
                      Close
                    </Button>
                    {selectedOpp.applyLink && (
                      <a href={selectedOpp.applyLink} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">
                        Apply Now <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </Card>
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
      <main className="min-h-screen grow bg-background transition-colors duration-slow">
        <Suspense fallback={<div className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
          <ExploreContent />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
