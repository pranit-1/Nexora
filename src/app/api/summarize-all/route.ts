import { NextResponse } from "next/server";
import { summarizePendingOpportunities } from "@/lib/storage/batchSummarizer";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Dev-friendly: allows localhost/manual runs without auth in non-production.
function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10) || 20;
  const force = url.searchParams.get("force") === "1";

  const stats = await summarizePendingOpportunities({ limit, force });

  return NextResponse.json({
    success: true,
    ...stats,
    note: "Background summarizer ran. Summary cache updated for the processed opportunities.",
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}