import { NextResponse } from "next/server";
import { seedOpportunities } from "@/lib/seedOpportunitiesData";
import { syncOpportunitiesToFirestore, getActiveOpportunitiesFromFirestore } from "@/lib/firestoreSync";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log(`[api/seed] Seeding ${seedOpportunities.length} opportunities into Firestore...`);
    const syncResult = await syncOpportunitiesToFirestore(seedOpportunities);
    const active = await getActiveOpportunitiesFromFirestore();

    return NextResponse.json({
      success: true,
      message: "Firestore seeded successfully",
      syncResult,
      totalActiveInFirestore: active.length,
    });
  } catch (error: any) {
    console.error("[api/seed] Error seeding Firestore:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to seed Firestore" },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
