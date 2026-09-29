// Rule-based automation engine.
// Handles deadline notifications and opportunity seeding with zero AI cost.
// Called on: first login, bookmarking an opportunity, navigating to notifications.

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { NotificationCategory } from "@/lib/types";

// Milestone thresholds (days before deadline) at which we fire timeline warnings
const DEADLINE_MILESTONES = [30, 14, 7, 3, 1];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  if (!dateStr) return -1;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return -1;
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDeadlineDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

async function notificationExists(uid: string, key: string): Promise<boolean> {
  const q = query(
    collection(db, "notifications", uid, "items"),
    where("key", "==", key)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

async function createNotification(
  uid: string,
  title: string,
  message: string,
  category: NotificationCategory,
  linkedRoute?: string,
  key?: string
): Promise<void> {
  // Prevent duplicate notifications using a dedup key
  if (key && (await notificationExists(uid, key))) return;

  await addDoc(collection(db, "notifications", uid, "items"), {
    uid,
    title,
    message,
    category,
    isRead: false,
    linkedRoute: linkedRoute || null,
    key: key || null,
    createdAt: new Date().toISOString(),
  });
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Called immediately when a user saves/bookmarks an opportunity.
 * 1. Fires an instant "Saved!" confirmation notification.
 * 2. Fires any deadline-milestone warnings that are currently relevant
 *    (i.e., the deadline is at or below a milestone threshold right now).
 */
export async function seedOpportunityNotification(
  uid: string,
  opportunityId: string,
  opportunityTitle: string,
  deadline: string
): Promise<void> {
  try {
    const days = daysUntil(deadline);

    // If deadline has already passed, skip
    if (days < 0) return;

    // 1. Immediate save confirmation (always fires once per opp)
    await createNotification(
      uid,
      "✅ Opportunity Saved",
      `"${opportunityTitle}" added to your saved list. Deadline: ${formatDeadlineDate(deadline)}.`,
      "new_opportunity",
      `/opportunity/${opportunityId}`,
      `saved_${opportunityId}`
    );

    // 2. Seed any milestone warnings that are currently triggered
    //    e.g. if they save with 6 days left → fire the 7-day warning immediately
    for (const milestone of DEADLINE_MILESTONES) {
      if (days <= milestone) {
        const urgency = days <= 1 ? "🔴 URGENT" : days <= 3 ? "🟠" : "⚠️";
        await createNotification(
          uid,
          `${urgency} ${days === 1 ? "Last Day" : `${days} Days Left`} — Deadline Alert`,
          `"${opportunityTitle}" closes in ${days} day${days === 1 ? "" : "s"}! Don't miss it.`,
          "deadline_alert",
          `/opportunity/${opportunityId}`,
          `warning_${milestone}d_${opportunityId}`
        );
        // Only fire the closest applicable milestone on initial save
        break;
      }
    }
  } catch (err) {
    console.error("AutomationEngine.seedOpportunityNotification error:", err);
  }
}

/**
 * Seed a welcome AI suggestion notification for new users.
 */
export async function seedWelcomeNotification(uid: string, name: string): Promise<void> {
  try {
    await createNotification(
      uid,
      "Welcome to NEXORA! 🌸",
      `Hi ${name}! Complete your profile so we can match you with the best opportunities. Head to the AI Hub to explore career tools.`,
      "ai_suggestion",
      "/profile",
      `welcome_${uid}`
    );
  } catch (err) {
    console.error("AutomationEngine.seedWelcomeNotification error:", err);
  }
}

/**
 * Generate application status update notification.
 */
export async function notifyApplicationUpdate(
  uid: string,
  opportunityTitle: string,
  newStatus: string
): Promise<void> {
  try {
    await createNotification(
      uid,
      "Application Status Updated",
      `Your application for "${opportunityTitle}" has been updated to: ${newStatus}.`,
      "application_update",
      "/dashboard"
    );
  } catch (err) {
    console.error("AutomationEngine.notifyApplicationUpdate error:", err);
  }
}

/**
 * Refresh deadline alerts for all bookmarked opportunities.
 * Called when user visits the notifications page.
 *
 * Strategy: For each saved opportunity, check current days remaining.
 * Fire a warning at each milestone threshold (30d / 14d / 7d / 3d / 1d)
 * using unique dedup keys, so each milestone fires ONCE in its lifecycle.
 *
 * Also reads the bookmark items snapshot so live-scraped opps (not in
 * Firestore org_opportunities) are still tracked correctly.
 */
export async function refreshDeadlineAlerts(uid: string): Promise<void> {
  try {
    const bookmarkSnap = await getDoc(doc(db, "bookmarks", uid));
    if (!bookmarkSnap.exists()) return;

    const data = bookmarkSnap.data();
    const savedIds: string[] = data.opportunityIds || [];
    const snapshotItems: Array<{ id: string; title: string; deadline?: string }> =
      Array.isArray(data.items) ? data.items : [];

    // Build a lookup from snapshot items (covers live/scraped opps)
    const snapshotMap = new Map<string, { title: string; deadline?: string }>();
    for (const item of snapshotItems) {
      if (item.id) snapshotMap.set(item.id, { title: item.title, deadline: item.deadline });
    }

    // Also pull Firestore-approved opportunities for those that may have updated deadlines
    let firestoreOpps: Array<{ id: string; title: string; deadline: string }> = [];
    try {
      const { getAllOpportunitiesOnce } = await import("@/lib/opportunitiesData");
      firestoreOpps = await getAllOpportunitiesOnce();
    } catch {
      // opportunitiesData may not be available in all contexts — continue with snapshots
    }
    const firestoreMap = new Map<string, { title: string; deadline: string }>();
    for (const o of firestoreOpps) {
      firestoreMap.set(o.id, { title: o.title, deadline: o.deadline });
    }

    for (const oppId of savedIds) {
      // Prefer live Firestore data (most up-to-date deadline), fall back to snapshot
      const live = firestoreMap.get(oppId);
      const snap = snapshotMap.get(oppId);
      const title = live?.title || snap?.title;
      const deadline = live?.deadline || snap?.deadline;

      if (!title || !deadline) continue;

      const days = daysUntil(deadline);
      if (days < 0) continue; // already past deadline

      // Fire a notification for each milestone the current day count falls at or below
      for (const milestone of DEADLINE_MILESTONES) {
        if (days <= milestone) {
          const urgency = days <= 1 ? "🔴 URGENT" : days <= 3 ? "🟠" : "⚠️";
          const dayLabel = days === 1 ? "Last Day" : `${days} Days Left`;
          await createNotification(
            uid,
            `${urgency} ${dayLabel} — Deadline Alert`,
            `"${title}" closes in ${days} day${days === 1 ? "" : "s"}! Apply now before the deadline.`,
            "deadline_alert",
            `/opportunity/${oppId}`,
            `warning_${milestone}d_${oppId}`
          );
          // Only fire the one tightest applicable milestone per refresh cycle
          break;
        }
      }
    }
  } catch (err) {
    console.error("AutomationEngine.refreshDeadlineAlerts error:", err);
  }
}
