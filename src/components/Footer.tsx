import Link from "next/link";
export default function Footer() {
  return (
    <footer className="bg-surface-footer border-t border-white/[0.06] text-white/70">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 py-10">
        <div className="grid md:grid-cols-[1.4fr_0.7fr_0.7fr] gap-8">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="h-7 w-7 rounded-[9px] bg-white text-[#1A1625] grid place-items-center text-[11px] font-black tracking-[0.12em]" style={{ fontFamily: "var(--font-display)" }}>N</span>
              <span className="text-white font-[800] tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>NEXORA</span>
              <span className="text-[10px] tracking-[0.16em] font-[700] text-white/50 border-l border-white/15 pl-3 ml-1">ATLAS</span>
            </Link>
            <p className="mt-3 max-w-[420px] text-[13px] leading-[1.6] text-white/60">Parchment calm, ink precision. A curated atlas of 400 opportunities — brass details, not gradients. Built for signal, not noise.</p>
            <p className="mt-3 text-[11px] tracking-[0.08em] font-[600] text-white/40">© 2026 NEXORA • Discover • Prepare • Grow</p>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.14em] font-[700] text-white/90">PLATFORM</div>
            <ul className="mt-3 space-y-2 text-[13px] text-white/60">
              <li><Link href="/explore" className="hover:text-white">Explore</Link></li>
              <li><Link href="/dashboard" className="hover:text-white">Dashboard</Link></li>
              <li><Link href="/saved" className="hover:text-white">Saved</Link></li>
              <li><Link href="/ai-hub" className="hover:text-white">AI Career Hub</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.14em] font-[700] text-white/90">RESOURCES</div>
            <ul className="mt-3 space-y-2 text-[13px] text-white/60">
              <li><Link href="/help" className="hover:text-white">Help</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-white">Terms</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
