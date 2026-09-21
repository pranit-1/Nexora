"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/context/AuthContext";
import { Search, ArrowUpRight, GraduationCap, Briefcase, Users, Compass, Trophy, Sparkles, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function Home() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [q, setQ] = useState("");
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/explore?search=${encodeURIComponent(q.trim())}` : "/explore");
  };

  return (
    <>
      <Navbar />
      <main className="flex-grow">
        {/* Masthead — editorial, not centered SaaS */}
        <section className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 pt-8 sm:pt-10 pb-10">
          <div className="flex items-center justify-between text-[10px] tracking-[0.14em] font-[700] text-foreground-muted border-y border-border py-2.5">
            <span className="hidden sm:inline">EST. 2026 — CURATED BY NEXORA EDITORS</span>
            <span>VOL. I — ATLAS OF OPPORTUNITY</span>
            <span className="hidden sm:inline flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> 400 LIVE LISTINGS</span>
          </div>

          {/* Asymmetric hero: 60/40 editorial */}
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-8 sm:gap-10 lg:gap-12 pt-8 sm:pt-10 items-start">
            <div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="inline-flex items-center gap-2 text-[11px] font-[700] tracking-[0.14em] text-secondary border border-accent-gold-surface bg-accent-gold-surface px-3 py-1.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary" /> DISCOVER • PREPARE • GROW
              </motion.div>

              <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease: EASE }} className="mt-5 text-[40px] sm:text-[56px] lg:text-[66px] font-[900] tracking-[-0.04em] leading-[0.9]" style={{ fontFamily: "var(--font-display)" }}>
                Every student<br />
                <span className="font-[300] italic tracking-[-0.03em] text-foreground/85">opportunity.</span><br />
                One <span className="underline decoration-[3px] decoration-secondary underline-offset-[10px]">intelligent</span><br />
                atlas.
              </motion.h1>

              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.5, ease: EASE }} className="mt-6 max-w-[560px] text-[15px] sm:text-[16px] leading-[1.65] text-foreground-muted">
                NEXORA is a parchment-calm, ink-precise atlas of scholarships, fellowships, internships and hackathons — scraped from 400 sources, summarized by AI, filtered with intent.
              </motion.p>

              {/* Search — editorial inset, not pill SaaS */}
              <motion.form onSubmit={onSearch} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22, ease: EASE }} className="mt-7 flex items-center gap-2 bg-surface border border-border rounded-[16px] p-1.5 shadow-[0_8px_30px_rgba(26,22,37,0.06)] focus-within:border-foreground focus-within:shadow-[0_12px_40px_rgba(26,22,37,0.10)] transition-all max-w-[560px]">
                <div className="flex items-center gap-3 flex-1 pl-4 min-w-0">
                  <Search className="w-[18px] h-[18px] text-foreground-muted shrink-0" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “Girls Go Circular, DAAD, or remote ML intern”" className="w-full bg-transparent outline-none text-[14px] placeholder:text-foreground-muted/70 py-2.5" />
                </div>
                <button type="submit" className="btn-ink shrink-0 hidden sm:inline-flex items-center gap-2">Explore <ArrowUpRight className="w-4 h-4" /></button>
                <button type="submit" className="btn-ink sm:hidden !px-4">Go</button>
              </motion.form>

              <div className="mt-4 flex flex-wrap gap-2 max-w-[560px]">
                {["Computer Science","Engineering","Data & AI","Design","Business","Sciences"].map((f) => (
                  <button key={f} onClick={() => router.push(`/explore?search=${encodeURIComponent(f)}`)} className="text-[12px] font-[600] tracking-[-0.01em] px-3 py-1.5 rounded-full bg-surface-raised border border-border hover:border-foreground hover:bg-surface transition-colors">{f}</button>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={currentUser ? "/dashboard" : "/auth/signup"} className="btn-ink inline-flex items-center gap-2">{currentUser ? "Open dashboard" : "Start free — no clutter"} <ArrowRight className="w-4 h-4" /></Link>
                <Link href="/ai-hub" className="btn-ghost inline-flex items-center gap-2"><Sparkles className="w-4 h-4 text-secondary" /> Try AI Career Hub</Link>
              </div>

              <p className="mt-3 text-[11px] tracking-[0.04em] text-foreground-muted">No spam. No purple gradients. Just verified pathways.</p>
            </div>

            {/* Right — asymmetric artifact stack (breaks centered hero cliché) */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.6, ease: EASE }} className="relative lg:sticky lg:top-[84px]">
              <div className="rounded-[22px] border border-border bg-surface overflow-hidden card-premium !p-0">
                <div className="h-1.5 w-full bg-gradient-to-r from-foreground via-secondary to-foreground/40" />
                <div className="p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <span className="label">Tonight’s curation</span>
                    <span className="text-[11px] font-[700] tracking-[0.08em] bg-success-surface text-success px-2.5 py-1 rounded-full">● LIVE</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {[
                      { k: "Hackathon", t: "Smart India Hackathon 2026 — Finals", m: "Offline • Free • Prize ₹10L", c: "Hackathons" },
                      { k: "Fellowship", t: "WISE-KIRAN Research Mobility", m: "Gov • Girls • 12 months", c: "Fellowships" },
                      { k: "Internship", t: "Remote ML Intern — Eduversity", m: "Remote • Paid • 3 mo", c: "Internships" },
                    ].map((it) => (
                      <div key={it.t} className="rounded-[14px] border border-border bg-surface-raised/60 p-3.5 flex gap-3 hover:bg-surface-raised transition-colors">
                        <span className="h-8 w-8 rounded-[10px] bg-foreground text-background grid place-items-center text-[10px] font-[800] tracking-[0.06em] shrink-0">{it.k[0]}</span>
                        <div className="min-w-0">
                          <div className="text-[13px] font-[700] leading-[1.3] tracking-[-0.01em] truncate">{it.t}</div>
                          <div className="text-[11px] text-foreground-muted mt-0.5">{it.m}</div>
                          <div className="mt-2 inline-flex text-[10px] font-[700] tracking-[0.08em] border border-border bg-surface px-2 py-1 rounded-full">{it.c}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link href="/explore" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground text-background py-3 text-[13px] font-[700] tracking-[-0.01em] hover:opacity-[0.92] transition-opacity">Open full atlas <ArrowUpRight className="w-4 h-4" /></Link>
                  <p className="mt-3 text-center text-[11px] text-foreground-muted">Scrape cadence: every 2 days • Expiry sweep: every 12h</p>
                </div>
              </div>

            </motion.div>
          </div>
          <hr className="hr-brass mt-10" />
        </section>

        {/* Categories — editorial index, not 3-col icon circles */}
        <section className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 py-10">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <h2 className="text-[26px] sm:text-[30px] font-[800] tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>Index</h2>
            <p className="text-[13px] text-foreground-muted max-w-[520px]">Six ledgers, each with its own filters — paid/unpaid, online/offline, gov/private, girls/boys — not one generic dropdown.</p>
          </div>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {[
              { name: "Scholarships", icon: GraduationCap, note: "Girls • Gov • Merit" },
              { name: "Fellowships", icon: Users, note: "Research • 12 mo" },
              { name: "Internships", icon: Briefcase, note: "Remote • Stipend" },
              { name: "Conferences", icon: Compass, note: "CFP • Virtual" },
              { name: "Hackathons", icon: Trophy, note: "Offline • Free" },
              { name: "STEM Programs", icon: Sparkles, note: "Atlas • 400" },
            ].map((cat) => {
              const I = cat.icon;
              return (
                <Link key={cat.name} href={`/explore?category=${cat.name}`} className="group rounded-[16px] border border-border bg-surface p-4 hover:border-foreground hover:shadow-[0_10px_28px_rgba(26,22,37,0.08)] transition-all">
                  <div className="h-9 w-9 rounded-[12px] bg-surface-raised border border-border grid place-items-center group-hover:bg-foreground group-hover:text-background group-hover:border-foreground transition-colors"><I className="w-4 h-4" /></div>
                  <div className="mt-3 text-[13px] font-[700] tracking-[-0.01em]">{cat.name}</div>
                  <div className="text-[11px] text-foreground-muted mt-0.5">{cat.note}</div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Why — 3-up but with editorial rule + asymmetry */}
        <section className="bg-surface border-y border-border">
          <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 py-10 sm:py-12">
            <div className="grid lg:grid-cols-[0.95fr_1.05fr] gap-8 items-start">
              <h2 className="text-[28px] sm:text-[34px] font-[800] tracking-[-0.03em] leading-[0.95]" style={{ fontFamily: "var(--font-display)" }}>Built for signal,<br /><span className="font-[400] italic">not noise.</span></h2>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { t: "One calm ledger", d: "400 sources distilled into one scroll, no scattered blogs." },
                  { t: "Smart, honest filters", d: "Each category owns its filters — not generic everywhere." },
                  { t: "Expiry as feature", d: "Pending stays, expired auto-prunes every 12 hours." },
                ].map((b) => (
                  <div key={b.t} className="rounded-[16px] border border-border bg-background p-4">
                    <div className="h-1 w-7 bg-secondary rounded-full" />
                    <div className="mt-3 text-[13px] font-[700] tracking-[-0.01em]">{b.t}</div>
                    <div className="mt-1 text-[12px] leading-[1.6] text-foreground-muted">{b.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials — tight, not generic centered cards */}
        <section className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 py-10">
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { q: "NEXORA replaced 12 tabs with one ledger. I found WISE-KIRAN in two minutes.", n: "Arjun Verma", r: "CS & AI, IIT Delhi" },
              { q: "Expiry sweep is honest — if it’s closed, it’s gone. No ghost listings.", n: "Sneha Nair", r: "SE, BITS Pilani" },
              { q: "AI summary turns a messy CFP page into 6 clear facts. Huge time saver.", n: "Karan Mehta", r: "Robotics, DTU" },
            ].map((t) => (
              <div key={t.n} className="rounded-[16px] border border-border bg-surface p-5">
                <p className="text-[13px] leading-[1.6]">“{t.q}”</p>
                <div className="mt-3 text-[12px] font-[700]">{t.n}</div>
                <div className="text-[11px] text-foreground-muted">{t.r}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
