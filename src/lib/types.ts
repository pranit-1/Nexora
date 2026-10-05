// Central type definitions for Phase 3 — NEXORA Opportunity Ecosystem
// All modules import from here. Do not define model interfaces elsewhere.

// ─── WALLET ────────────────────────────────────────────────────────────────

export type WalletCategory =
  | "Resume"
  | "Certificates"
  | "Awards"
  | "Projects"
  | "Results"
  | "ID Documents"
  | "Other";

/** "manual" means the user picked it by hand, so auto re-scan must never move it. */
export type WalletCategorySource = "auto" | "manual";

export interface WalletDocument {
  id: string;
  uid: string;
  category: WalletCategory;
  name: string;
  storagePath: string;
  downloadURL: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  categorySource?: WalletCategorySource;
  categoryConfidence?: number;
  categoryReason?: string;
  /** Set when classification was weak, so the UI can flag it for review. */
  categoryNeedsReview?: boolean;
  categoryUpdatedAt?: string;
  /** First slice of the file's real text. The performance engine reads from here. */
  extractedText?: string;
  /** Structured facts parsed out of the text (GPA, issuer, skills, year, ...). */
  insights?: DocumentInsights;
}

// ─── DOCUMENT INSIGHTS ─────────────────────────────────────────────────────

/** Facts pulled out of a single document's text. Every field is optional. */
export interface DocumentInsights {
  institution?: string;
  issuer?: string;
  /** Normalised to 0-100 so scores are comparable across grading scales. */
  gpa?: number;
  gpaRaw?: string;
  percentage?: number;
  rollNumber?: string;
  graduationYear?: number;
  documentDate?: string;
  field?: string;
  skills: string[];
  technologies: string[];
  languages: string[];
  orgType?: "government" | "academic" | "ngo" | "private" | "unknown";
  isGovtId?: boolean;
  awardLevel?: "international" | "national" | "state" | "university" | "college";
  contactEmail?: string;
  contactPhone?: string;
  links: string[];
  keywords: string[];
  // Marksheet-specific (Results category)
  marksheetClass?: "10" | "12";
  marksheetStream?: "science" | "commerce" | "arts" | "vocational";
  marksheetBoard?: string;
  marksheetSubjects?: Array<{ name: string; marks: number; maxMarks?: number }>;
}

// ─── PERFORMANCE PROFILE ───────────────────────────────────────────────────

/**
 * Each dimension is scored 0-100 from the wallet documents that back it.
 * A dimension with no documents at all is reported as `missing` and left out
 * of the weighted average — it lowers `coverage` instead of dragging the score
 * down, and it is listed in `gaps` so the user knows exactly what to upload.
 */
export type PerformanceDimensionKey =
  | "academics"
  | "credentials"
  | "recognition"
  | "projects"
  | "skills"
  | "recency"
  | "network"
  | "github"
  | "coding"
  | "readiness";

export type PerformanceBand = "strong" | "solid" | "developing" | "early" | "empty";

/** How a saved public link is treated by the score and the UI. */
export type ProfileLinkKind = "linkedin" | "github" | "leetcode" | "codechef" | "codeforces" | "hackerrank" | "portfolio" | "social" | "website" | "other";

/** A public profile URL the user saved by hand — LinkedIn, GitHub, anything. */
export interface ProfileLink {
  id: string;
  url: string;
  kind: ProfileLinkKind;
  /** Shown in the list. Defaults to the kind's name, e.g. "LinkedIn". */
  label?: string;
  addedAt?: string;
  /** Where it came from: typed by the user, or read out of an uploaded document. */
  origin?: "manual" | "document";
}

export interface PerformanceDimension {
  key: PerformanceDimensionKey;
  label: string;
  score: number;
  weight: number;
  /** How many wallet documents fed this dimension. */
  docCount: number;
  /** True when no document supports this dimension yet. */
  missing: boolean;
  evidence: string[];
  notes: string[];
}

export interface PerformanceProfile {
  /** Weighted score across the dimensions that have evidence. 0 when empty. */
  overall: number;
  /** What the score would become if every missing dimension were filled. */
  potential: number;
  band: PerformanceBand;
  /** Share of dimensions that actually have documents behind them (0-100). */
  coverage: number;
  docCount: number;
  dimensions: PerformanceDimension[];
  strengths: string[];
  gaps: string[];
  nextSteps: string[];
  /** LLM-written read of the numbers. Falls back to a rule-built summary. */
  narrative: string;
  /** Category histogram, so the UI can show where the documents live. */
  categoryCounts: Partial<Record<WalletCategory, number>>;
  /** Documents that still need the user to confirm their category. */
  needsReviewCount: number;
  /** The user's saved public profile links, mirrored into the snapshot. */
  profileLinks?: ProfileLink[];
  /** Top technologies/skills detected across all documents. */
  topTechnologies?: string[];
  /** Top skills detected across all documents. */
  topSkills?: string[];
  /** Specific skill gaps identified for target roles. */
  skillGaps?: string[];
  /** Recommended preparation focus areas. */
  prepFocus?: string[];
  /** AI-evaluated student level tier (e.g. Level 3: Competent Practitioner). */
  studentLevel?: string;
  /** AI justification and deep analysis of student caliber. */
  studentLevelDescription?: string;
  computedAt: string;
  engineVersion: number;
}

/** The persisted snapshot at users/{uid}/tracker/performance. */
export interface PerformanceSnapshot extends PerformanceProfile {
  uid: string;
  /** Changes whenever any document's category or review flag changes. */
  fingerprint?: string;
  bandLabel?: string;
}

// ─── CALENDAR ──────────────────────────────────────────────────────

export type CalendarEventType =
  | "deadline"
  | "interview"
  | "reminder"
  | "general"
  | "event";

export interface CalendarEvent {
  id: string;
  uid: string;
  title: string;
  date: string; // YYYY-MM-DD
  type: CalendarEventType;
  description?: string;
  linkedOpportunityId?: string;
  createdAt: string;
}

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────

export type NotificationCategory =
  | "deadline_alert"
  | "new_opportunity"
  | "application_update"
  | "interview_reminder"
  | "ai_suggestion";

export interface NotificationItem {
  id: string;
  uid: string;
  title: string;
  message: string;
  category: NotificationCategory;
  isRead: boolean;
  linkedRoute?: string;
  createdAt: string;
}

// ─── COMMUNITY ─────────────────────────────────────────────────────────────

export type CommunityTag =
  | "Scholarships"
  | "Career"
  | "Resume"
  | "Mentorship"
  | "General"
  | "Success Story";

export interface CommunityPost {
  id: string;
  authorUid: string;
  authorName: string;
  authorInitial: string;
  isAnonymous: boolean;
  title: string;
  body: string;
  tag: CommunityTag;
  likes: number;
  replyCount: number;
  createdAt: string;
}

export interface CommunityReply {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorInitial: string;
  isAnonymous: boolean;
  body: string;
  createdAt: string;
}

export interface MentorshipRequest {
  id: string;
  uid: string;
  name: string;
  field: string;
  goals: string;
  availability: string;
  createdAt: string;
}

// ─── ORGANIZATION ACCESS REQUESTS ─────────────────────────────────────────

export type OrgRequestStatus = "pending" | "approved" | "rejected";

export interface OrgRequest {
  uid: string;
  orgName: string;
  website?: string;
  description: string;
  requesterName: string;
  requesterEmail: string;
  status: OrgRequestStatus;
  createdAt: string;
  reviewedAt?: string;
}

// ─── ORGANIZATION ──────────────────────────────────────────────────────────

export interface OrgProfile {
  uid: string;
  name: string;
  logoURL?: string;
  website?: string;
  description?: string;
  createdAt: string;
}

export type OrgOpportunityStatus = "pending" | "approved" | "rejected";

// Where this listing came from. "organization" = posted by a verified org
// account via the dashboard. "automated" = pulled in by the daily ingestion
// pipeline (see src/lib/ingestion).
export type OpportunitySource = "organization" | "automated";

// Only relevant when source === "automated".
// "trusted-feed" = official RSS/API (Grants.gov, Devpost, etc) — auto-approved.
// "scraped" = parsed from a web page — always starts as "pending" for review.
export type OpportunitySourceType = "trusted-feed" | "scraped";

export interface OrgOpportunity {
  id: string;
  postedByUid: string;
  orgName: string;
  title: string;
  description: string;
  eligibility: string;
  deadline: string;
  country: string;
  category: string;
  field: string;
  applyLink: string;
  requiredDocuments: string[];
  status: OrgOpportunityStatus;
  applicationCount: number;
  viewCount: number;
  createdAt: string;
  source?: OpportunitySource;
  sourceType?: OpportunitySourceType;
  sourceUrl?: string;
  ingestedAt?: string;
}

// ─── ADMIN ─────────────────────────────────────────────────────────────────

export interface AdminStats {
  totalUsers: number;
  totalOpportunities: number;
  orgPostedCount: number;
  seededCount: number;
  totalApplications: number;
  totalCommunityPosts: number;
}

// ─── USER ROLE ─────────────────────────────────────────────────────────────

export type UserRole = "user" | "organization" | "admin";
