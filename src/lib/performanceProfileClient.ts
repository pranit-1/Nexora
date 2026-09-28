import type { PerformanceSnapshot } from "@/lib/types";

/**
 * Thin browser-side helper around /api/wallet/performance-profile.
 * Every wallet mutation calls this so the score never goes stale.
 * Fire-and-forget: a failure here must never block an upload or a re-scan.
 */
export async function refreshPerformanceProfile(uid: string, opts: { refreshNarrative?: boolean } = {}): Promise<PerformanceSnapshot | null> {
  if (!uid) return null;
  try {
    const res = await fetch("/api/wallet/performance-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, refreshNarrative: !!opts.refreshNarrative }),
    });
    if (!res.ok) {
      console.warn("[performance] refresh failed:", res.status);
      return null;
    }
    return (await res.json()) as PerformanceSnapshot;
  } catch (e) {
    console.warn("[performance] refresh error:", (e as Error)?.message);
    return null;
  }
}

export async function fetchPerformanceProfile(uid: string): Promise<PerformanceSnapshot | null> {
  if (!uid) return null;
  try {
    const res = await fetch(`/api/wallet/performance-profile?uid=${encodeURIComponent(uid)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PerformanceSnapshot;
  } catch (e) {
    console.warn("[performance] fetch error:", (e as Error)?.message);
    return null;
  }
}
