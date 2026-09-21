"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ThemeToggle from "@/components/ThemeToggle";

export default function Navbar() {
  const pathname = usePathname();
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const links = [
    { name: "Home", href: "/" },
    { name: "Explore", href: "/explore" },
    { name: "Saved", href: "/saved" },
    { name: "Dashboard", href: "/dashboard" },
    { name: "AI Hub", href: "/ai-hub" },
    { name: "Profile", href: "/profile" },
  ];
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <motion.nav
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`sticky top-0 z-50 border-b backdrop-blur-[14px] transition-all duration-300 ${scrolled ? "bg-surface/92 shadow-[0_1px_0_var(--border),0_12px_32px_rgba(26,22,37,0.07)]" : "bg-surface/72"}`}
      style={{ borderColor: "var(--border)" }}
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8">
        <div className="flex h-[64px] items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3 group shrink-0">
            <div className="h-[30px] w-[30px] rounded-[9px] bg-foreground text-background grid place-items-center text-[11px] font-black tracking-[0.12em] group-hover:rotate-[6deg] transition-transform duration-300" style={{ fontFamily: "var(--font-display)" }}>N</div>
            <span className="text-[17px] font-[800] tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>NEXORA</span>
          </Link>



          <div className="hidden lg:flex items-center gap-1">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link key={l.href} href={l.href} className={`relative px-3.5 py-2 text-[13px] font-[600] tracking-[-0.01em] rounded-[10px] transition-colors ${active ? "text-foreground bg-surface-raised" : "text-foreground-muted hover:text-foreground hover:bg-surface-raised/70"}`}>
                  {l.name}
                  {active && <motion.span layoutId="ink-underline" className="absolute left-3 right-3 -bottom-[1px] h-[1.5px] bg-foreground rounded-full" transition={{ type: "spring", stiffness: 420, damping: 30 }} />}
                </Link>
              );
            })}
          </div>

          <div className="hidden lg:flex items-center gap-2.5">
            <ThemeToggle compact />
            {currentUser ? (
              <div className="flex items-center gap-3 pl-3 ml-1 border-l border-border">
                <div className="h-7 w-7 rounded-full bg-foreground text-background grid place-items-center text-[11px] font-[750]">{(currentUser.displayName || currentUser.email || "U")[0].toUpperCase()}</div>
                <span className="max-w-[130px] truncate text-[13px] font-[600] tracking-[-0.01em] hidden xl:inline">{currentUser.displayName || currentUser.email}</span>
                <button onClick={() => logout()} className="h-8 w-8 grid place-items-center rounded-[10px] border border-border hover:border-foreground text-foreground-muted hover:text-foreground transition-colors" title="Sign out"><LogOut className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                <Link href="/auth/login" className="text-[13px] font-[600] tracking-[-0.01em] px-4 py-2 rounded-full hover:bg-surface-raised transition-colors">Sign in</Link>
                <Link href="/auth/signup" className="btn-ink text-[13px] !py-2 !px-5">Join NEXORA</Link>
              </>
            )}
          </div>

          <div className="flex lg:hidden items-center gap-1.5">
            <ThemeToggle compact />
            <button onClick={() => setOpen((v) => !v)} className="h-9 w-9 grid place-items-center rounded-[10px] border border-border bg-surface text-foreground">
              <AnimatePresence mode="wait" initial={false}>
                {open ? <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.16 }}><X className="w-4 h-4" /></motion.span> : <motion.span key="m" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.16 }}><Menu className="w-4 h-4" /></motion.span>}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }} className="lg:hidden overflow-hidden border-t border-border bg-surface">
            <div className="px-4 py-4 space-y-1">
              {links.map((l) => {
                const active = pathname === l.href;
                return <Link key={l.href} href={l.href} className={`block px-3 py-2.5 rounded-[12px] text-[14px] font-[600] ${active ? "bg-foreground text-background" : "text-foreground-muted hover:text-foreground bg-surface-raised/60"}`}>{l.name}</Link>;
              })}
              <div className="pt-3 mt-3 border-t border-border flex gap-2">
                {currentUser ? <button onClick={() => logout()} className="flex-1 btn-ghost text-center justify-center flex items-center gap-2"><LogOut className="w-4 h-4" /> Sign out</button> : <><Link href="/auth/login" className="flex-1 btn-ghost text-center">Sign in</Link><Link href="/auth/signup" className="flex-1 btn-ink text-center">Join</Link></>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
