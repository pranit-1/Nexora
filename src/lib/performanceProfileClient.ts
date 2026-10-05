import type { PerformanceSnapshot } from "@/lib/types";
import { authedFetch, authedJson } from "@/lib/apiClient";

/**
 * Thin browser-side helper around /api/wallet/performance-profile.
 * Every wallet mutation calls this so the score never goes stale.
 * Fire-and-forget: a failure here must never block an upload or a re-scan.
 *
 * The route derives the uid from the verified ID token, so it is no longer sent
 * from the client — the `uid` argument is retained only as a "signed in" guard
 * and for call-site readability.
 */
export async function refreshPerformanceProfile(uid: string, opts: { refreshNarrative?: boolean; force?: boolean } = {}): Promise<PerformanceSnapshot | null> {
  if (!uid) return null;
  try {
    return await authedJson<PerformanceSnapshot>("/api/wallet/performance-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshNarrative: !!opts.refreshNarrative, force: !!opts.force }),
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    // Re-throw so the caller can decide how to handle it (e.g. show rate-limit message)
    // Fire-and-forget silent background refreshes should catch this themselves.
    throw err;
  }
}

export async function fetchPerformanceProfile(uid: string): Promise<PerformanceSnapshot | null> {
  if (!uid) return null;
  try {
    const res = await authedFetch("/api/wallet/performance-profile", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PerformanceSnapshot;
  } catch (e) {
    console.warn("[performance] fetch error:", (e as Error)?.message);
    return null;
  }
}