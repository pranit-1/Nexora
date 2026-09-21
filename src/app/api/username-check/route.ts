import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const u = (url.searchParams.get("u") || "").trim().toLowerCase();
  if (!u || !/^[a-z0-9_]{3,20}$/.test(u)) {
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
    // if admin not configured (local dev without keys), fallback to available: true for UX
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.FIREBASE_PROJECT_ID) {
      return NextResponse.json({ available: true, fallback: true });
    }
    console.error("[username-check] error", e.message);
    return NextResponse.json({ available: false, error: e.message }, { status: 500 });
  }
}
