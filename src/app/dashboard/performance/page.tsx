"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Gauge,
  Loader2,
  RefreshCw,
  Wallet,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Target,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fetchPerformanceProfile, refreshPerformanceProfile } from "@/lib/performanceProfileClient";
import { bandLabel } from "@/lib/wallet/performanceProfile";
import { WALLET_CATEGORIES } from "@/lib/wallet/categories";
import type { PerformanceBand, PerformanceSnapshot } from "@/lib/types";

const BAND_STYLES: Record<PerformanceBand, { ring: string; text: string; chip: string }> = {
  strong: { ring: "stroke-success", text: "text-success", chip: "bg-success/10 text-success border-success/20" },
  solid: { ring: "stroke-primary", text: "text-primary", chip: "bg-primary/10 text-primary border-primary/20" },
  developing: { ring: "stroke-warning", text: "text-warning", chip: "bg-warning-surface text-warning border-warning/20" },
  early: { ring: "stroke-foreground-muted", text: "text-foreground-muted", chip: "bg-surface-raised text-foreground-muted border-border" },
  empty: { ring: "stroke-border", text: "text-foreground-muted", chip: "bg-surface-raised text-foreground-muted border-border" },
};

function ScoreRing({ score, band }: { score: number; band: PerformanceBand }) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const style = BAND_STYLES[band];

  return (
    <div className="relative w-[168px] h-[168px] shrink-0">
      <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
        <circle cx="80" cy="80" r={radius} className="fill-none stroke-border" strokeWidth="12" />
        <circle
          cx="80"
          cy="80"
          r={radius}
          className={`fill-none ${style.ring} transition-all duration-700`}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-black ${style.text}`}>{Math.round(score)}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-foreground-muted mt-1">out of 100</span>
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
  return (
    <div className="p-4 bg-surface border border-border rounded-2xl">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-foreground">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase text-foreground-muted">
            {Math.round(weight * 100)}% weight
          </span>
          <span
            className={`text-sm font-black ${missing ? "text-foreground-muted" : score >= 70 ? "text-success" : score >= 45 ? "text-warning" : "text-danger"}`}
          >
            {missing ? "—" : score}
          </span>
        </span>
      </div>

      <div className="h-2 bg-surface-raised rounded-full mt-2 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${missing ? 0 : Math.min(100, score)}%` }}
          transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
          className={`h-full rounded-full ${missing ? "bg-border" : score >= 70 ? "bg-success" : score >= 45 ? "bg-warning" : "bg-danger"}`}
        />
      </div>

      <p className="text-[10px] text-foreground-muted mt-2">
        {missing
          ? "No documents back this dimension yet — it is left out of your average."
          : `Based on ${docCount} document${docCount === 1 ? "" : "s"}.`}
      </p>

      {evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {evidence.slice(0, 4).map((e) => (
            <li key={e} className="text-[11px] text-foreground flex items-start gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-success mt-0.5 shrink-0" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {notes.slice(0, 2).map((n) => (
            <li key={n} className="text-[11px] text-foreground-muted flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 text-warning mt-0.5 shrink-0" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const { currentUser } = useAuth();
  const [profile, setProfile] = useState<PerformanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const data = await fetchPerformanceProfile(currentUser.uid);
    setProfile(data);
    setLoading(false);
  }, [currentUser]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async () => {
    if (!currentUser || refreshing) return;
    setRefreshing(true);
    const data = await refreshPerformanceProfile(currentUser.uid, { refreshNarrative: true });
    if (data) setProfile(data);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const band = profile?.band || "empty";
  const style = BAND_STYLES[band];

  return (
    <motion.div
      className="max-w-5xl mx-auto space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <Gauge className="w-6 h-6 text-primary" /> Performance Profile
          </h1>
          <p className="text-foreground-muted text-sm mt-1 max-w-2xl">
            Every score here is calculated from the documents in your wallet — the marksheet, certificates,
            awards and projects you uploaded. Upload more, and the numbers move on their own.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/wallet"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-surface border border-border rounded-xl text-foreground hover:bg-surface-raised transition-colors"
          >
            <Wallet className="w-4 h-4" /> Wallet
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Recalculate
          </button>
        </div>
      </div>

      {/* Score card */}
      <div className="p-6 bg-surface border border-border rounded-3xl flex flex-col md:flex-row items-center gap-6">
        <ScoreRing score={profile?.overall || 0} band={band} />

        <div className="flex-1 w-full space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider border rounded-full ${style.chip}`}>
              {bandLabel(band)}
            </span>
            {profile && profile.potential > profile.overall && (
              <span className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider border rounded-full bg-primary/10 text-primary border-primary/20 inline-flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Potential {Math.round(profile.potential)}/100
              </span>
            )}
          </div>

          <p className="text-sm text-foreground leading-relaxed">{profile?.narrative}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            {[
              { label: "Documents", value: profile?.docCount ?? 0 },
              { label: "Evidence coverage", value: `${profile?.coverage ?? 0}%` },
              { label: "Needs review", value: profile?.needsReviewCount ?? 0 },
              { label: "Last computed", value: profile?.computedAt ? new Date(profile.computedAt).toLocaleDateString() : "—" },
            ].map((s) => (
              <div key={s.label} className="px-3 py-2 bg-surface-raised border border-border rounded-xl">
                <span className="block text-[9px] font-bold uppercase text-foreground-muted">{s.label}</span>
                <span className="text-sm font-black text-foreground">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(!profile || profile.docCount === 0) && (
        <div className="p-6 bg-surface border border-dashed border-border rounded-3xl text-center space-y-3">
          <Sparkles className="w-8 h-8 text-primary mx-auto" />
          <h2 className="text-lg font-bold text-foreground">Nothing to score yet</h2>
          <p className="text-sm text-foreground-muted max-w-md mx-auto">
            Upload your resume, marksheets, certificates, awards and project reports to the wallet. Each file is
            read by the AI, filed into the right category, and turned into evidence for your score.
          </p>
          <Link
            href="/dashboard/wallet"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-primary text-white rounded-xl hover:opacity-90 transition-opacity"
          >
            <Wallet className="w-4 h-4" /> Open wallet <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {profile && profile.docCount > 0 && (
        <>
          {/* Dimensions */}
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" /> Score breakdown
            </h2>
            <p className="text-xs text-foreground-muted mt-1">
              Dimensions with no documents are excluded from the average instead of counting as zero.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              {profile.dimensions.map((d) => (
                <DimensionBar
                  key={d.key}
                  label={d.label}
                  score={d.score}
                  weight={d.weight}
                  missing={d.missing}
                  docCount={d.docCount}
                  evidence={d.evidence}
                  notes={d.notes}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Strengths */}
            <div className="p-5 bg-surface border border-border rounded-2xl">
              <h3 className="text-xs font-bold uppercase tracking-wider text-success flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Proven strengths
              </h3>
              <ul className="mt-3 space-y-2">
                {profile.strengths.length ? (
                  profile.strengths.map((s) => (
                    <li key={s} className="text-xs text-foreground leading-relaxed">{s}</li>
                  ))
                ) : (
                  <li className="text-xs text-foreground-muted">No dimension has crossed 60 yet.</li>
                )}
              </ul>
            </div>

            {/* Gaps */}
            <div className="p-5 bg-surface border border-border rounded-2xl">
              <h3 className="text-xs font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> What is holding you back
              </h3>
              <ul className="mt-3 space-y-2">
                {profile.gaps.length ? (
                  profile.gaps.map((g) => (
                    <li key={g} className="text-xs text-foreground leading-relaxed">{g}</li>
                  ))
                ) : (
                  <li className="text-xs text-foreground-muted">Nothing outstanding.</li>
                )}
              </ul>
            </div>

            {/* Next steps */}
            <div className="p-5 bg-primary/30 border border-primary/10 rounded-2xl">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" /> Highest-impact next steps
              </h3>
              <ol className="mt-3 space-y-2">
                {profile.nextSteps.length ? (
                  profile.nextSteps.map((s, i) => (
                    <li key={s} className="text-xs text-foreground leading-relaxed flex gap-2">
                      <span className="font-black text-primary">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-foreground">Your profile is complete. Keep it fresh.</li>
                )}
              </ol>
              <Link
                href="/dashboard/wallet"
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
              >
                Upload documents <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Where the documents live */}
          <div className="p-5 bg-surface border border-border rounded-2xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Where your evidence sits</h3>
            <div className="flex flex-wrap gap-2 mt-3">
              {WALLET_CATEGORIES.map((c) => {
                const count = profile.categoryCounts[c] || 0;
                return (
                  <span
                    key={c}
                    className={`px-3 py-1.5 text-xs font-semibold border rounded-full ${
                      count > 0 ? "bg-primary/10 text-primary border-primary/20" : "bg-surface-raised text-foreground-muted border-border"
                    }`}
                  >
                    {c}: {count}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
