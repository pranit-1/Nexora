"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Loader2,
  RefreshCw,
  Wallet,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Target,
  Link2,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fetchPerformanceProfile, refreshPerformanceProfile } from "@/lib/performanceProfileClient";
import { bandLabel } from "@/lib/wallet/performanceProfile";
import { WALLET_CATEGORIES } from "@/lib/wallet/categories";
import { kindLabel } from "@/lib/profileLinks";
import type { PerformanceBand, PerformanceSnapshot } from "@/lib/types";
import { Button, Card, Chip } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

/**
 * The band used to carry three separate hand-written colour strings, one of
 * which (`solid`) was a `bg-primary/10 text-primary` pair no other surface
 * used. `tone` now resolves through the shared `Chip` vocabulary so "strong"
 * reads identically here and on the overview card.
 */
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

/** Score → bar colour, resolved once so the number and the bar never disagree. */
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
    // Try the cached snapshot first (fast, read-only GET)
    const cached = await fetchPerformanceProfile(currentUser.uid);
    if (cached) {
      // Snapshot exists — use it immediately, then silently refresh in background
      setProfile(cached);
      setLoading(false);
      // Quietly recompute in background so numbers stay fresh
      refreshPerformanceProfile(currentUser.uid, { refreshNarrative: false })
        .then((fresh) => { if (fresh) setProfile(fresh); })
        .catch(() => {/* non-critical */});
    } else {
      // No cached snapshot yet — compute for the first time (shows spinner)
      const fresh = await refreshPerformanceProfile(currentUser.uid, { refreshNarrative: true });
      setProfile(fresh);
      setLoading(false);
    }
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
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
      </div>
    );
  }

  const band = profile?.band || "empty";
  const style = BAND_STYLES[band];

  const summaryStats = [
    { label: "Documents", value: profile?.docCount ?? 0 },
    { label: "Evidence coverage", value: `${profile?.coverage ?? 0}%` },
    { label: "Needs review", value: profile?.needsReviewCount ?? 0 },
    {
      label: "Last computed",
      value: profile?.computedAt ? new Date(profile.computedAt).toLocaleDateString() : "—",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <Reveal>
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <span className="eyebrow text-secondary">Readiness</span>
            <h1 className="mt-3 text-display-sm text-foreground">Performance Profile</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-muted text-pretty">
              Every score here is calculated from the documents in your wallet — the marksheet, certificates,
              awards and projects you uploaded. Upload more, and the numbers move on their own.
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
      </Reveal>

      {/* Score card */}
      <Reveal delay={0.05}>
        <Card className="flex flex-col items-center gap-8 p-8 md:flex-row">
          <ScoreRing score={profile?.overall || 0} band={band} />

          <div className="w-full flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={style.tone}>{bandLabel(band)}</Chip>
              {profile && profile.potential > profile.overall && (
                <Chip tone="gold" icon={<TrendingUp className="h-3 w-3" />}>
                  Potential {Math.round(profile.potential)}/100
                </Chip>
              )}
            </div>

            <p className="text-base leading-relaxed text-foreground text-pretty">{profile?.narrative}</p>

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

      {(!profile || profile.docCount === 0) && (
        <Reveal>
          <Card tone="inset" className="border-dashed p-10 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-border bg-surface text-secondary">
              <Sparkles className="h-5 w-5" />
            </span>
            <h2 className="mt-5 font-display text-xl text-foreground">Nothing to score yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-foreground-muted text-pretty">
              Upload your resume, marksheets, certificates, awards and project reports to the wallet. Each file
              is read by the AI, filed into the right category, and turned into evidence for your score.
            </p>
            <Button as="a" href="/dashboard/wallet" className="mt-6">
              <Wallet className="h-4 w-4" /> Open wallet
            </Button>
          </Card>
        </Reveal>
      )}

      {profile && profile.docCount > 0 && (
        <>
          <Reveal>
            <div>
              <h2 className="flex items-center gap-2 font-display text-lg text-foreground">
                <Target className="h-5 w-5 text-secondary" /> Score breakdown
              </h2>
              <p className="mt-2 text-xs text-foreground-muted">
                Dimensions with no documents are excluded from the average instead of counting as zero.
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

          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StaggerItem>
              <Card className="h-full p-5">
                <h3 className="eyebrow flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Proven strengths
                </h3>
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
                <h3 className="eyebrow flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-4 w-4" /> What is holding you back
                </h3>
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
                <h3 className="eyebrow flex items-center gap-1.5 text-secondary">
                  <TrendingUp className="h-4 w-4" /> Highest-impact next steps
                </h3>
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

          {/* Saved public profile links */}
          {profile.profileLinks && profile.profileLinks.length > 0 && (
            <Reveal>
              <Card className="p-5">
                <h3 className="eyebrow flex items-center gap-1.5">
                  <Link2 className="h-4 w-4" /> Your public profiles
                </h3>
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
                  These count as verified evidence toward Application Readiness. Manage them in the{" "}
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

          {/* Top technologies & skills */}
          {(profile.topTechnologies?.length || profile.topSkills?.length) && (
            <Reveal>
              <Card className="p-5">
                <h3 className="eyebrow flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" /> Your tech stack & skills
                </h3>
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
                <h3 className="eyebrow flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-4 w-4" /> Skill gaps to address
                </h3>
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
                <h3 className="eyebrow flex items-center gap-1.5 text-secondary">
                  <Target className="h-4 w-4" /> Preparation focus
                </h3>
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

          {/* Where the documents live */}
          <Reveal>
            <Card className="p-5">
              <h3 className="eyebrow">Where your evidence sits</h3>
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