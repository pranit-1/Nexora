import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Firestore caps an `in` query at 30 values. */
const MAX_ORG_NAMES_PER_QUERY = 30;

/**
 * GET /api/organization/applications
 *
 * Lists the candidate applications targeting programs the caller has posted.
 *
 * The browser used to query `applications` directly with
 * `where("organization", "==", profile.name)`. Firestore rules cannot join an
 * `org_opportunities` lookup against an `applications` query, and the org name
 * is user-supplied text, so the rules cannot express "this caller owns this
 * org". Leaving it open would let any signed-in user enumerate every candidate
 * application in the platform. Resolving the caller's own posted programs
 * server-side keeps the existing feature working with real authorization.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const uid = auth.user.uid;

  const limited = enforceRateLimit(request, { ...LIMITS.applicationStatus, uid });
  if (!limited.ok) return limited.response;

  const db = getAdminDb();
  const opps = db.collection("org_opportunities");

  const ownedOpps = await opps.where("postedByUid", "==", uid).get();

  const orgNames = new Set<string>();
  ownedOpps.forEach((d) => {
    const data = d.data() ?? {};
    if (typeof data.organization === "string" && data.organization.trim()) {
      orgNames.add(data.organization.trim());
    }
    if (typeof data.orgName === "string" && data.orgName.trim()) {
      orgNames.add(data.orgName.trim());
    }
  });

  if (orgNames.size === 0) {
    return NextResponse.json({ ok: true, applications: [] });
  }

  const names = [...orgNames].slice(0, MAX_ORG_NAMES_PER_QUERY);
  const apps = await db
    .collection("applications")
    .where("organization", "in", names)
    .limit(200)
    .get();

  const applications = apps.docs.map((d) => ({ id: d.id, ...d.data() }));

  return NextResponse.json({ ok: true, applications });
}