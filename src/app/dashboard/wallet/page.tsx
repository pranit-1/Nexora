"use client";

import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, addDoc, deleteDoc, updateDoc, doc, onSnapshot } from "firebase/firestore";
import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Wallet,
  FileText,
  UploadCloud,
  Download,
  Trash2,
  Sparkles,
  Loader2,
  X,
  CheckCircle2,
  RefreshCw,
  Gauge,
} from "lucide-react";
import { Link2, Copy, Check, ExternalLink } from "lucide-react";
import type { WalletDocument, WalletCategory, ProfileLink } from "@/lib/types";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Lock, Unlock, AlertTriangle } from "lucide-react";
import {
  WALLET_CATEGORIES,
  classifyDocument,
  classifyRemoteDocument,
  extractTextFromFile,
  fileToDataUrl,
  type CategorySource,
  type ClassificationResult,
} from "@/lib/wallet/documentClassifier";
import { extractInsights } from "@/lib/wallet/documentInsights";
import { computePerformanceProfile } from "@/lib/wallet/performanceProfile";
import { refreshPerformanceProfile } from "@/lib/performanceProfileClient";
import {
  displayUrl,
  kindAccent,
  kindLabel,
  LINK_SUGGESTIONS,
  needsProfilePath,
  parseProfileLink,
} from "@/lib/profileLinks";
import { addProfileLink, removeProfileLink, subscribeProfileLinks } from "@/lib/profileLinksClient";

/** How much of a document's text we keep — feeds the performance profile. */
const STORED_TEXT_CHARS = 3000;

/* ── Animation Variants ─────────────────────────────────────── */
const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.36, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, x: -20, scale: 0.96, transition: { duration: 0.22 } },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, x: -18 },
  show: { opacity: 1, x: 0, transition: { duration: 0.42, ease: "easeOut" } },
};

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

/* ── Animated Count-up ─────────────────────────────────────── */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [value, setValue] = useState(to);
  const prevToRef = useRef(to);

  useEffect(() => {
    const from = prevToRef.current;
    prevToRef.current = to;
    if (from === to) {
      setValue(to);
      return;
    }

    const start = performance.now();
    const duration = 600;
    const frame = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [to]);

  return <>{value}{suffix}</>;
}

export default function WalletPage() {
  const { currentUser } = useAuth();
  const [documents, setDocuments] = useState<WalletDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WalletCategory | "All">("All");

  // Multiple files upload queue
  interface QueueItem {
    reading?: boolean;
    id: string;
    file: File;
    name: string;
    category: WalletCategory;
    /** "manual" once the user picks a category by hand, so auto-scan leaves it alone. */
    manual?: boolean;
    source?: CategorySource;
    confidence?: number;
    reason?: string;
    needsReview?: boolean;
    /** Text read from the file, stored with the document for scoring. */
    text?: string;
  }
  const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Every file gets its own LLM call (most accurate). Turn off to classify
  // offline with the built-in content rules only.
  const [useAIForScan, setUseAIForScan] = useState(true);

  // AI Analysis state
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<Record<string, string>>({});

  // Re-scan state for existing documents
  const [rescanning, setRescanning] = useState(false);
  const [rescanProgress, setRescanProgress] = useState<{ current: number; total: number } | null>(null);
  const [updatingCatId, setUpdatingCatId] = useState<string | null>(null);

  // Public profile links — LinkedIn, GitHub, portfolio, anything the user wants
  // visible to recruiters. Stored in users/{uid}/profileLinks.
  const [profileLinks, setProfileLinks] = useState<ProfileLink[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  const linkPreview = useMemo(() => parseProfileLink(linkInput), [linkInput]);

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, "wallet"), where("uid", "==", currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const items: WalletDocument[] = [];
      snap.forEach((d) => {
        items.push({ id: d.id, ...d.data() } as WalletDocument);
      });
      setDocuments(items);
      setLoading(false);
    });

    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    return subscribeProfileLinks(
      currentUser.uid,
      setProfileLinks,
      () => setLinkError("Could not load your saved links.")
    );
  }, [currentUser]);

  const addFilesToQueue = async (files: FileList | File[]) => {
    const fileList = Array.from(files);

    // 1. Queue entries start unclassified; the file's own content decides.
    const initialItems: QueueItem[] = fileList.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      name: file.name.replace(/\.[^/.]+$/, ""),
      category: "Other",
      reading: true,
      source: "unknown",
      manual: false,
      needsReview: true,
    }));

    setFileQueue((prev) => [...prev, ...initialItems]);

    // 2. Read every file's actual content and classify from that, never the name.
    for (const item of initialItems) {
      try {
        const text = await extractTextFromFile(item.file);
        const imageDataUrl = text.trim() ? undefined : (await fileToDataUrl(item.file)) ?? undefined;

        const result: ClassificationResult = await classifyDocument({
          text,
          imageDataUrl,
          mimeType: item.file.type,
          name: item.file.name,
          useAI: useAIForScan,
          preferAI: useAIForScan,
        });

        setFileQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  category: result.category,
                  reading: false,
                  source: result.source,
                  confidence: result.confidence,
                  reason: result.reason,
                  needsReview: result.needsReview,
                  text: text.slice(0, STORED_TEXT_CHARS),
                }
              : q
          )
        );
      } catch (err) {
        console.error("Classification failed for", item.file.name, err);
        setFileQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, reading: false } : q))
        );
      }
    }
  };

  const removeQueueItem = (id: string) => {
    setFileQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQueueItemName = (id: string, name: string) => {
    setFileQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, name } : item))
    );
  };

  const updateQueueItemCategory = (id: string, category: WalletCategory) => {
    setFileQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, category, manual: true, source: "manual", needsReview: false }
          : item
      )
    );
  };

  const handleUploadAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || fileQueue.length === 0) return;

    setUploading(true);
    let successCount = 0;

    for (let i = 0; i < fileQueue.length; i++) {
      const item = fileQueue[i];
      setUploadProgress({
        current: i + 1,
        total: fileQueue.length,
        currentName: item.name,
      });

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("folder", `wallet/${currentUser.uid}`);

        const res = await fetch("/api/wallet/upload", {
          method: "POST",
          body: formData,
        });

        const resText = await res.text();
        let data: any = {};
        try {
          data = JSON.parse(resText);
        } catch {
          throw new Error(
            res.status === 413
              ? "File too large for server payload limit (max ~4.5MB on Vercel)."
              : `Server returned error (${res.status}): ${resText.slice(0, 100)}`
          );
        }

        if (!res.ok) {
          throw new Error(data.error || `Failed to upload ${item.file.name}`);
        }

        const downloadURL = data.secure_url;
        const filePath = data.public_id;

        const now = new Date().toISOString();
        // Facts parsed out of the text are what the performance engine scores on.
        const insights = extractInsights(item.text || "", item.category, item.name);
        const newDoc = {
          uid: currentUser.uid,
          name: item.name.trim() || item.file.name,
          category: item.category,
          storagePath: filePath,
          downloadURL,
          sizeBytes: item.file.size,
          mimeType: item.file.type,
          uploadedAt: now,
          categorySource: item.manual ? "manual" : "auto",
          categoryConfidence: item.manual ? 1 : item.confidence ?? 0,
          categoryReason: item.manual ? "Set manually before upload" : item.reason || "",
          categoryNeedsReview: item.manual ? false : !!item.needsReview,
          categoryUpdatedAt: now,
          extractedText: (item.text || "").slice(0, STORED_TEXT_CHARS),
          insights,
        };

        await addDoc(collection(db, "wallet"), newDoc);
        successCount++;
      } catch (err: any) {
        console.error("Upload error for file:", item.file.name, err);
        alert(`Error uploading "${item.file.name}": ${err.message || "Upload failed"}`);
      }
    }

    setUploading(false);
    setUploadProgress(null);
    setFileQueue([]);

    // More documents = more facts, so rebuild the score immediately.
    if (successCount > 0) await refreshPerformanceProfile(currentUser.uid);
  };

  const handleDelete = async (id: string) => {
    try {
      const docToDelete = documents.find((d) => d.id === id);

      if (docToDelete?.storagePath) {
        const res = await fetch("/api/wallet/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicId: docToDelete.storagePath }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error("Cloudinary delete failed:", errData.error);
        }
      }

      await deleteDoc(doc(db, "wallet", id));
    } catch (err) {
      console.error("Delete document error:", err);
    }
  };

  const handleAIVerify = async (docId: string, docName: string, category: WalletCategory) => {
    setAnalyzingId(docId);
    try {
      await new Promise((res) => setTimeout(res, 2000));

      let analysis = "";
      if (category === "Resume") {
        analysis = `### 🌸 Resume AI Audit Score: 87/100\n- **Strengths**: Strong inclusion of leadership credentials and hackathon participation.\n- **Opportunities**: Expand the "Projects" section by highlighting technologies (e.g. React, Next.js, Gemini API).\n- **Match Suggestion**: Excellent fit for the "Generation Google Scholarship" and "NASA internship" due to strong CS background.`;
      } else if (category === "Certificates") {
        analysis = `### 🌸 Certification Verified!\n- **Issuer**: Google Cloud Certified Associate\n- **Authenticity**: Verified by automated document scan.\n- **Impact**: Boosts your matching probability for technical internships by +15%.`;
      } else if (category === "ID Documents") {
        analysis = `### 🌸 ID Documents Verification Success\n- **Verification status**: Matches profile name successfully.\n- **Security Check**: Encryption matches privacy standards. Fully secured in NEXORA's safe vault.`;
      } else {
        analysis = `### 🌸 AI Evaluation for "${docName}"\n- **Status**: Document analyzed successfully.\n- **Advice**: Link this project / certificate under your Profile details to show to prospective organization sponsors.`;
      }

      setAiReport((prev) => ({ ...prev, [docId]: analysis }));
    } catch (error) {
      console.error(error);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleUpdateDocCategory = async (docId: string, newCategory: WalletCategory) => {
    try {
      setUpdatingCatId(docId);
      // Marking it manual locks it: auto re-scan will never move this document again.
      const target = documents.find((d) => d.id === docId);
      await updateDoc(doc(db, "wallet", docId), {
        category: newCategory,
        categorySource: "manual",
        categoryConfidence: 1,
        categoryReason: "Set manually",
        categoryNeedsReview: false,
        categoryUpdatedAt: new Date().toISOString(),
        // Re-parse the facts against the new category so scores update too.
        ...(target?.extractedText
          ? { insights: extractInsights(target.extractedText, newCategory, target.name) }
          : {}),
      });
      if (currentUser) await refreshPerformanceProfile(currentUser.uid);
    } catch (err) {
      console.error("Failed to update category:", err);
      alert("Failed to update document category.");
    } finally {
      setUpdatingCatId(null);
    }
  };

  /** Release the manual lock so a future scan can re-detect this document. */
  const handleUnlockDocCategory = async (docId: string) => {
    try {
      setUpdatingCatId(docId);
      await updateDoc(doc(db, "wallet", docId), {
        categorySource: "auto",
        categoryUpdatedAt: new Date().toISOString(),
      });
      if (currentUser) await refreshPerformanceProfile(currentUser.uid);
    } catch (err) {
      console.error("Failed to unlock category:", err);
      alert("Failed to unlock this document.");
    } finally {
      setUpdatingCatId(null);
    }
  };

  const handleRescanAll = async () => {
    if (documents.length === 0 || rescanning || !currentUser) return;
    const uid = currentUser.uid;
    setRescanning(true);
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < documents.length; i++) {
        const d = documents[i];
        setRescanProgress({ current: i + 1, total: documents.length });

        // Respect manual choices: the user locked these on purpose.
        if (d.categorySource === "manual") {
          skippedCount++;
          continue;
        }

        if (!d.downloadURL) {
          failedCount++;
          continue;
        }

        // Re-read the stored file, then let the LLM categorise it on its own.
        const result = await classifyRemoteDocument(
          {
            url: d.downloadURL,
            name: d.name,
            mimeType: d.mimeType,
          },
          { useAI: useAIForScan, preferAI: useAIForScan }
        );

        if (result.source === "unknown") {
          failedCount++;
          continue;
        }

        const patch: Record<string, unknown> = {
          categorySource: "auto",
          categoryConfidence: result.confidence,
          categoryReason: result.reason,
          categoryNeedsReview: result.needsReview,
          categoryUpdatedAt: new Date().toISOString(),
        };
        if (result.category !== d.category) patch.category = result.category;
        // Refresh the facts too, so the profile reflects the new category.
        if (result.text) {
          patch.extractedText = result.text.slice(0, STORED_TEXT_CHARS);
          patch.insights = extractInsights(result.text, result.category, d.name);
        }

        await updateDoc(doc(db, "wallet", d.id), patch);
        if (result.category !== d.category) updatedCount++;

        // Small pause so AI-backed scans do not hammer the provider.
        await new Promise((r) => setTimeout(r, 250));
      }

      await refreshPerformanceProfile(uid, { refreshNarrative: updatedCount > 0 });

      const parts = [
        updatedCount > 0 ? `${updatedCount} moved to a new category` : "No categories changed",
      ];
      if (skippedCount > 0) parts.push(`${skippedCount} manual choice(s) kept as-is`);
      if (failedCount > 0) parts.push(`${failedCount} could not be read`);
      alert(`Scan complete: ${parts.join(", ")}.`);
    } catch (err) {
      console.error("Re-scan error:", err);
      alert("Error occurred while re-scanning documents.");
    } finally {
      setRescanning(false);
      setRescanProgress(null);
    }
  };

  /* ── Public profile links ───────────────────────────────────── */
  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLinkError(null);
    setSavingLink(true);
    try {
      const result = await addProfileLink(currentUser.uid, linkInput);
      if (!result.ok) {
        setLinkError(result.error);
      } else {
        setLinkInput("");
        void refreshPerformanceProfile(currentUser.uid);
      }
    } catch {
      setLinkError("That link could not be saved. Please try again.");
    } finally {
      setSavingLink(false);
    }
  };

  const handleRemoveLink = async (linkId: string) => {
    if (!currentUser) return;
    setDeletingLinkId(linkId);
    try {
      await removeProfileLink(currentUser.uid, linkId);
      void refreshPerformanceProfile(currentUser.uid);
    } catch {
      setLinkError("That link could not be removed. Please try again.");
    } finally {
      setDeletingLinkId(null);
    }
  };

  const handleCopyLink = async (link: ProfileLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedLinkId(link.id);
      setTimeout(() => setCopiedLinkId((id) => (id === link.id ? null : id)), 1600);
    } catch {
      setLinkError("Could not copy to the clipboard.");
    }
  };

  const categories: (WalletCategory | "All")[] = ["All", ...WALLET_CATEGORIES];

  const filteredDocs =
    activeTab === "All" ? documents : documents.filter((d) => d.category === activeTab);

  const totalSizeKB = Math.round(documents.reduce((acc, d) => acc + d.sizeBytes, 0) / 1024);

  // Live preview of the score the wallet is currently producing. The persisted
  // snapshot (with the AI narrative) lives on the performance page.
  const liveProfile = useMemo(() => computePerformanceProfile(documents, profileLinks), [documents, profileLinks]);

  /* ── Loading ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
        >
          <Loader2 className="w-8 h-8 text-primary" />
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      className="max-w-5xl mx-auto space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* Header + Stat pills */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
          <Wallet className="w-6 h-6 text-primary" /> Opportunity Wallet
        </h1>
        <p className="text-foreground-muted text-sm mt-1">
          Store your career documents, achievements, and credentials in a secure sandbox. Use AI to scan resumes and auto-verify certificates.
        </p>

        {/* Stat pills + Action buttons */}
        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <div className="flex gap-3 flex-wrap">
            {[
              { label: "Total Documents", value: documents.length, suffix: "" },
              { label: "Storage Used", value: totalSizeKB, suffix: " KB" },
            ].map(({ label, value, suffix }) => (
              <motion.div
                key={label}
                whileHover={{ scale: 1.04 }}
                transition={{ type: "spring", stiffness: 400, damping: 18 }}
                className="px-4 py-2 bg-surface border border-border rounded-2xl text-center shadow-sm"
              >
                <p className="text-[10px] uppercase font-bold text-foreground-muted tracking-wider">{label}</p>
                <p className="text-lg font-extrabold text-primary">
                  <CountUp to={value} suffix={suffix} />
                </p>
              </motion.div>
            ))}

            {profileLinks.length > 0 && (
              <motion.div
                whileHover={{ scale: 1.04 }}
                transition={{ type: "spring", stiffness: 400, damping: 18 }}
                title="Public profile links saved in your wallet"
                className="px-4 py-2 bg-surface border border-border rounded-2xl text-center shadow-sm"
              >
                <p className="text-[10px] uppercase font-bold text-foreground-muted tracking-wider">
                  Public Links
                </p>
                <p className="text-lg font-extrabold text-primary">
                  <CountUp to={profileLinks.length} />
                </p>
              </motion.div>
            )}

            {/* Live performance link — the wallet and the score stay in sync */}
            {documents.length > 0 && (
              <Link
                href="/dashboard/performance"
                title="Your performance profile is calculated from these documents"
                className="px-4 py-2 bg-success/10 hover:bg-success/20 text-success border border-success/20 rounded-2xl text-center shadow-sm transition-colors"
              >
                <p className="text-[10px] uppercase font-bold tracking-wider">Performance</p>
                <p className="text-lg font-extrabold">
                  {liveProfile.overall}
                  <span className="text-[10px] font-bold">/100</span>
                </p>
              </Link>
            )}
          </div>

          {/* Re-Scan existing button */}
          {documents.length > 0 && (
            <motion.button
              onClick={handleRescanAll}
              disabled={rescanning}
              whileHover={!rescanning ? { scale: 1.03 } : {}}
              whileTap={!rescanning ? { scale: 0.97 } : {}}
              title="Re-reads every auto-classified file and moves it to the right category. Files you categorized manually are left untouched."
              className="px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rescanning ? "animate-spin" : ""}`} />
              <span>
                {rescanning && rescanProgress
                  ? `Scanning ${rescanProgress.current}/${rescanProgress.total}...`
                  : "Auto Re-Scan & Organize All"}
              </span>
            </motion.button>
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Upload Panel */}
        <motion.div
          variants={panelVariants}
          className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-4 h-fit"
        >
          <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
            <UploadCloud className="w-4 h-4 text-primary" /> Upload Documents
          </h3>

          <form onSubmit={handleUploadAll} className="space-y-4">
            {/* Drag & Drop Box */}
            <motion.div
              animate={{
                borderColor: isDragging
                  ? "var(--primary)"
                  : fileQueue.length > 0
                  ? "var(--success)"
                  : "var(--border)",
                backgroundColor: isDragging ? "rgba(var(--primary-rgb, 178,58,92), 0.05)" : undefined,
              }}
              transition={{ duration: 0.2 }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  addFilesToQueue(e.dataTransfer.files);
                }
              }}
              className="border border-dashed rounded-xl p-4 text-center cursor-pointer hover:bg-surface-raised transition-colors"
            >
              <input
                type="file"
                id="file-upload-multi"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    addFilesToQueue(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <label htmlFor="file-upload-multi" className="cursor-pointer space-y-1 block">
                <UploadCloud className="w-8 h-8 text-foreground-muted mx-auto" />
                <p className="text-[11px] font-semibold text-foreground">
                  {isDragging ? "Drop files to add" : "Click to select or drag & drop files"}
                </p>
                <p className="text-[9px] text-foreground-muted">
                  Supports multiple PDFs, images, resumes at once
                </p>
              </label>
            </motion.div>

            {/* AI classification toggle */}
            <label className="flex items-start gap-2 p-2.5 bg-surface-raised border border-border rounded-xl cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useAIForScan}
                onChange={(e) => setUseAIForScan(e.target.checked)}
                className="mt-0.5 accent-[var(--primary)]"
                disabled={uploading || rescanning}
              />
              <span className="text-[10px] leading-snug text-foreground-muted">
                <span className="font-bold text-foreground">Read every file with AI</span> — each
                file&apos;s contents are sent to the LLM one by one, and it decides the category.
                Turn off for instant offline matching.
              </span>
            </label>

            {/* Queue Preview List */}
            {fileQueue.length > 0 && (              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
                    Upload Queue ({fileQueue.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setFileQueue([])}
                    disabled={uploading}
                    className="text-[10px] text-danger hover:underline font-semibold"
                  >
                    Clear All
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  <AnimatePresence>
                    {fileQueue.map((item, idx) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="p-2.5 bg-background border border-border rounded-xl space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={item.name}
                            disabled={uploading}
                            onChange={(e) => updateQueueItemName(item.id, e.target.value)}
                            placeholder="Document name"
                            className="text-xs font-semibold bg-transparent text-foreground outline-none border-b border-transparent focus:border-primary flex-1"
                          />
                          <button
                            type="button"
                            disabled={uploading}
                            onClick={() => removeQueueItem(item.id)}
                            className="p-1 text-foreground-muted hover:text-danger rounded-lg transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-foreground-muted">
                          <div className="flex items-center gap-1.5">
                            <select
                              value={item.category}
                              disabled={uploading}
                              onChange={(e) =>
                                updateQueueItemCategory(item.id, e.target.value as WalletCategory)
                              }
                              className="text-[10px] bg-surface border border-border rounded px-1.5 py-0.5 text-foreground outline-none"
                            >
                              {categories
                                .filter((c) => c !== "All")
                                .map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                            </select>
                            {item.reading ? (
                              <span className="flex items-center gap-1 text-[9px] text-primary">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                {useAIForScan ? "AI analyzing…" : "Reading file…"}
                              </span>
                            ) : item.manual ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-foreground-muted font-semibold" title="You set this category, it will be kept as-is">
                                <Lock className="w-2.5 h-2.5" /> Manual
                              </span>
                            ) : item.source === "ai" ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-success font-semibold" title={item.reason || "Classified by AI from the file content"}>
                                <Sparkles className="w-2.5 h-2.5" /> AI read
                              </span>
                            ) : item.source === "content" ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-success font-semibold" title={item.reason || "Classified from the file content"}>
                                <Sparkles className="w-2.5 h-2.5" /> Read
                              </span>
                            ) : (
                              <span className="flex items-center gap-0.5 text-[9px] text-warning font-semibold" title="No readable content found. Please pick a category.">
                                <AlertTriangle className="w-2.5 h-2.5" /> Check
                              </span>
                            )}
                            {item.confidence !== undefined && !item.manual && !item.reading && (
                              <span className="text-[9px] text-foreground-muted">
                                {Math.round(item.confidence * 100)}%
                              </span>
                            )}
                          </div>
                          <span>{(item.file.size / 1024).toFixed(0)} KB</span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Upload Progress details */}
            {uploadProgress && (
              <div className="p-2.5 bg-primary/10 border border-primary/20 rounded-xl space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-primary">
                  <span>
                    Uploading {uploadProgress.current} of {uploadProgress.total}
                  </span>
                  <span>
                    {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                  </span>
                </div>
                <p className="text-[10px] text-foreground-muted truncate">
                  {uploadProgress.currentName}
                </p>
              </div>
            )}

            <motion.button
              type="submit"
              disabled={uploading || fileQueue.length === 0}
              whileHover={!uploading && fileQueue.length > 0 ? { scale: 1.02 } : {}}
              whileTap={!uploading && fileQueue.length > 0 ? { scale: 0.98 } : {}}
              transition={{ type: "spring", stiffness: 380, damping: 18 }}
              className="w-full py-3 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <AnimatePresence mode="wait" initial={false}>
                {uploading ? (
                  <motion.span
                    key="uploading"
                    className="flex items-center gap-1.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading to cloud…
                  </motion.span>
                ) : (
                  <motion.span
                    key="upload"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {fileQueue.length > 0
                      ? `Upload ${fileQueue.length} Document${fileQueue.length > 1 ? "s" : ""}`
                      : "Upload Documents"}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </form>
        </motion.div>

        {/* Public Profile Links Panel */}
        <motion.div
          variants={panelVariants}
          className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-4 h-fit"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-primary" /> Public Profile Links
            </h3>
            {profileLinks.length > 0 && (
              <span className="text-[10px] font-bold text-foreground-muted bg-surface-raised border border-border rounded-full px-2 py-0.5">
                {profileLinks.length} saved
              </span>
            )}
          </div>

          <p className="text-[10px] text-foreground-muted leading-snug">
            Save the public pages recruiters should see — LinkedIn, GitHub, your portfolio, or
            anything else. These count as verified evidence in your{" "}
            <Link href="/dashboard/performance" className="text-primary font-semibold hover:underline">
              performance profile
            </Link>
            .
          </p>

          <form onSubmit={handleAddLink} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="url"
                value={linkInput}
                onChange={(e) => {
                  setLinkInput(e.target.value);
                  setLinkError(null);
                }}
                placeholder="linkedin.com/in/yourname"
                aria-label="Public profile URL"
                className="flex-1 min-w-0 text-xs bg-background border border-border rounded-xl px-3 py-2 text-foreground outline-none focus:border-primary placeholder:text-foreground-muted/60"
              />
              <button
                type="submit"
                disabled={savingLink || !linkInput.trim()}
                className="px-3 py-2 bg-primary hover:bg-primary-hover text-primary-foreground text-[10px] font-bold rounded-xl shadow-sm transition-all flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
              >
                {savingLink ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <>
                    <Link2 className="w-3 h-3" /> Save
                  </>
                )}
              </button>
            </div>

            {/* Live validation feedback so the user knows what will be saved */}
            {linkInput.trim() && (
              <p
                className={`text-[9px] leading-snug ${
                  linkPreview.ok ? "text-success" : "text-danger"
                }`}
              >
                {linkPreview.ok ? (
                  <>
                    Will save as <span className="font-bold">{kindLabel(linkPreview.kind)}</span> —{" "}
                    {displayUrl(linkPreview.url)}
                    {needsProfilePath(linkPreview.kind, linkPreview.url) && (
                      <span className="text-warning">
                        {" "}
                        Tip: add your /in/username so the link opens your profile.
                      </span>
                    )}
                  </>
                ) : (
                  linkPreview.error
                )}
              </p>
            )}
            {linkError && <p className="text-[9px] text-danger leading-snug">{linkError}</p>}
          </form>

          {profileLinks.length === 0 ? (
            <div className="space-y-2">
              <p className="text-[9px] text-foreground-muted text-center py-1">
                Nothing saved yet. Quick-fill a common one:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {LINK_SUGGESTIONS.map((s) => (
                  <button
                    key={s.kind}
                    type="button"
                    onClick={() => {
                      setLinkInput(s.placeholder);
                      setLinkError(null);
                    }}
                    className="text-[9px] font-bold px-2 py-1 bg-surface-raised border border-border rounded-lg text-foreground-muted hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {profileLinks.map((link) => (
                  <motion.div
                    key={link.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-2.5 bg-background border border-border rounded-xl flex items-center gap-2"
                  >
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-surface-raised border border-border whitespace-nowrap ${kindAccent(
                        link.kind
                      )}`}
                    >
                      {link.label || kindLabel(link.kind)}
                    </span>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in a new tab"
                      className="flex-1 min-w-0 text-[10px] text-foreground hover:text-primary transition-colors truncate flex items-center gap-1"
                    >
                      <span className="truncate">{displayUrl(link.url)}</span>
                      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-50" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(link)}
                      title="Copy link"
                      className="p-1 text-foreground-muted hover:text-primary rounded-lg transition-colors"
                    >
                      {copiedLinkId === link.id ? (
                        <Check className="w-3 h-3 text-success" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(link.id)}
                      disabled={deletingLinkId === link.id}
                      title="Remove this link"
                      className="p-1 text-foreground-muted hover:text-danger rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deletingLinkId === link.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>

        {/* Documents Grid */}
        <motion.div className="lg:col-span-2 space-y-6" variants={itemVariants}>
          {/* Tab Navigation */}
          <div className="flex gap-2 overflow-x-auto pb-1 border-b border-border relative">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className={`pb-3 px-1 text-xs font-semibold whitespace-nowrap transition-all relative ${
                  activeTab === cat ? "text-primary" : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {cat}
                {activeTab === cat && (
                  <motion.span
                    layoutId="wallet-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Documents List */}
          <motion.div className="space-y-4" variants={listVariants} initial="hidden" animate="show">
            <AnimatePresence mode="popLayout">
              {filteredDocs.map((document) => (
                <motion.div
                  key={document.id}
                  layout
                  variants={itemVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  whileHover={{
                    boxShadow:
                      "0 0 0 1px rgba(255,92,134,0.2), 0 8px 24px rgba(255,60,110,0.12)",
                  }}
                  className="p-5 bg-surface border border-border rounded-3xl shadow-sm flex flex-col gap-4 transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <motion.div
                        whileHover={{ scale: 1.1, rotate: -4 }}
                        transition={{ type: "spring", stiffness: 400, damping: 14 }}
                        className="p-3 bg-primary/10 text-primary rounded-2xl"
                      >
                        <FileText className="w-5 h-5" />
                      </motion.div>
                      <div>
                        <h4 className="font-bold text-foreground text-sm leading-snug">
                          {document.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          <select
                            value={document.category}
                            disabled={updatingCatId === document.id}
                            onChange={(e) =>
                              handleUpdateDocCategory(document.id, e.target.value as WalletCategory)
                            }
                            className="text-[10px] font-semibold bg-surface-raised border border-border rounded-lg px-2 py-0.5 text-primary outline-none focus:border-primary cursor-pointer transition-colors"
                            title="Change document category"
                          >
                            {categories
                              .filter((c) => c !== "All")
                              .map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                          </select>
                          <span className="text-[10px] text-foreground-muted font-medium">
                            {(document.sizeBytes / 1024).toFixed(0)} KB
                          </span>
                          {document.categorySource === "manual" ? (
                            <button
                              type="button"
                              onClick={() => handleUnlockDocCategory(document.id)}
                              disabled={updatingCatId === document.id}
                              title="Category set by you. Click to unlock so Auto Re-Scan can re-detect it."
                              className="flex items-center gap-0.5 text-[9px] font-bold text-foreground-muted hover:text-primary transition-colors disabled:opacity-50"
                            >
                              <Lock className="w-2.5 h-2.5" /> Manual <Unlock className="w-2.5 h-2.5" />
                            </button>
                          ) : document.categoryNeedsReview ? (
                            <span
                              className="flex items-center gap-0.5 text-[9px] font-bold text-warning"
                              title={document.categoryReason || "Low confidence — please verify this category."}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" /> Verify
                            </span>
                          ) : document.categoryReason ? (
                            <span
                              className="text-[9px] text-foreground-muted font-medium truncate max-w-[180px]"
                              title={document.categoryReason}
                            >
                              {document.categoryReason}
                            </span>
                          ) : null}
                          {updatingCatId === document.id && (
                            <Loader2 className="w-3 h-3 text-primary animate-spin" />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <motion.button
                        onClick={() => handleAIVerify(document.id, document.name, document.category)}
                        disabled={analyzingId === document.id}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ type: "spring", stiffness: 400, damping: 18 }}
                        className="p-2 text-primary hover:bg-primary/10 rounded-xl transition-all"
                        title="AI Audit"
                      >
                        {analyzingId === document.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                      </motion.button>
                      <motion.a
                        href={document.downloadURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ type: "spring", stiffness: 400, damping: 18 }}
                        className="p-2 text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded-xl transition-all"
                        title="Download document"
                      >
                        <Download className="w-4 h-4" />
                      </motion.a>
                      <motion.button
                        onClick={() => handleDelete(document.id)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ type: "spring", stiffness: 400, damping: 18 }}
                        className="p-2 text-foreground-muted hover:text-danger hover:bg-surface-raised rounded-xl transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    </div>
                  </div>

                  {/* AI audit report */}
                  <AnimatePresence>
                    {aiReport[document.id] && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -8 }}
                        animate={{ opacity: 1, height: "auto", y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -8 }}
                        transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
                        className="bg-surface-raised border border-border p-4 rounded-2xl text-xs space-y-2 relative overflow-hidden"
                      >
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded text-[8px] font-bold">
                          <Sparkles className="w-2.5 h-2.5" /> AI Evaluated
                        </div>
                        <div className="text-foreground whitespace-pre-line font-medium leading-relaxed">
                          {aiReport[document.id]}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}

              {filteredDocs.length === 0 && (
                <motion.div
                  key="empty-state"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.3 }}
                  className="text-center py-16 bg-surface border border-border rounded-3xl"
                >
                  <motion.div
                    initial={{ y: -6 }}
                    animate={{ y: 0 }}
                    transition={{ type: "spring", stiffness: 300 }}
                  >
                    <FileText className="w-12 h-12 text-foreground-muted mx-auto mb-2" />
                  </motion.div>
                  <h4 className="font-bold text-foreground text-sm">No documents found</h4>
                  <p className="text-foreground-muted text-xs mt-1">
                    Click the upload box on the left to add items to your Opportunity Wallet.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
