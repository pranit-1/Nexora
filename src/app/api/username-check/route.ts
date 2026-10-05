import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { usernameRegex } from "@/lib/schemas";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Public endpoint (it runs before signup, when there is no session yet) but
  // rate limited and no longer fail-open: a backend failure must not report a
  // taken username as available.
  const limited = enforceRateLimit(request, LIMITS.usernameCheck);
  if (!limited.ok) return limited.response;

  const url = new URL(request.url);
  const u = (url.searchParams.get("u") || "").trim().toLowerCase();
  if (!u || !usernameRegex.test(u)) {
    return NextResponse.json({ available: false, reason: "invalid" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const snap = await db.doc(`usernames/${u}`).get();
    if (snap.exists) return NextResponse.json({ available: false });
    // also double-check users collection (legacy docs without usernames entry)
    const q = await db.collection("users").where("username", "==", u).limit(1).get();
    if (!q.empty) return NextResponse.json({ available: false });
    return NextResponse.json({ available: true });
  } catch (e: any) {
    // Local dev without credentials: keep signup usable, but say so explicitly
    // rather than silently claiming the name is free.
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.FIREBASE_PROJECT_ID) {
      return NextResponse.json({ available: true, unverified: true });
    }
    console.error("[username-check] error", e.message);
    return NextResponse.json(
      { available: false, error: "Could not verify availability. Please try again." },
      { status: 503 }
    );
  }
}