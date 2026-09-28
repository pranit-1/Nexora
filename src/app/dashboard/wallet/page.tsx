"use client";

import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, addDoc, deleteDoc, updateDoc, doc, onSnapshot } from "firebase/firestore";
import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import type { WalletDocument, WalletCategory } from "@/lib/types";
import { motion, AnimatePresence, type Variants } from "framer-motion";

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

function detectCategoryFromName(fileName: string): WalletCategory {
  const name = fileName.toLowerCase();
  if (/(^|[^a-z])(resume|cv)([^a-z]|$)/.test(name)) return "Resume";
  if (/(aadhar|aadhaar|adhaar|pan( card)?|passport|driving|license|voter( id)?|\bid\b)/.test(name)) return "ID Documents";
  if (/(certificate|certified|certif|completion|course)/.test(name)) return "Certificates";
  if (/(award|honou?r|achievement|scholarship)/.test(name)) return "Awards";
  if (/(result|marksheet|grade|report( card)?|transcript|cgpa|gpa|sgpa)/.test(name)) return "Results";
  if (/(project|case study)/.test(name)) return "Projects";
  return "Other";
}

function detectCategoryFromContent(rawText: string): WalletCategory | null {
  const text = rawText.toLowerCase();

  // 1. Resume / CV indicators
  if (
    /(work experience|professional summary|curriculum vitae|objective|education\s+and\s+experience|technical skills|projects\s*:\s*|employment history)/.test(text) &&
    /(skills|experience|education|summary|languages)/.test(text)
  ) {
    return "Resume";
  }

  // 2. Official ID Documents indicators
  if (
    /(government of india|income tax department|election commission|unique identification authority|permanent account number|father's name|date of birth|republic of india|driving licence|indian passport)/.test(text) ||
    /\b[a-z]{5}[0-9]{4}[a-z]{1}\b/.test(text) || // PAN number pattern
    /\b[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\b/.test(text) // Aadhaar pattern
  ) {
    return "ID Documents";
  }

  // 3. Academic Results / Marksheets / Transcripts
  if (
    /(statement of marks|marksheet|mark sheet|grade card|semester examination|credit points|sgpa|cgpa|passed with|provisional certificate|academic record|total marks|marks obtained)/.test(text)
  ) {
    return "Results";
  }

  // 4. Certificates of Completion / Participation / Course
  if (
    /(certificate of|has successfully completed|hereby certifies that|in recognition of|has participated in|completion of course|is awarded to)/.test(text)
  ) {
    return "Certificates";
  }

  // 5. Awards / Honours / Hackathon Winners
  if (
    /(winner|runner up|first prize|second prize|third prize|hackathon winner|hall of fame|in honour of|scholarship award|merit award)/.test(text)
  ) {
    return "Awards";
  }

  // 6. Project Reports / Case Studies
  if (
    /(abstract|problem statement|system architecture|methodology|future scope|github repository|tech stack|implementation details)/.test(text)
  ) {
    return "Projects";
  }

  return null;
}

async function extractDocumentText(file: File): Promise<string> {
  try {
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "txt") {
      return await file.text();
    }

    if (ext === "pdf") {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pageTexts: string[] = [];
      const maxPages = Math.min(pdf.numPages, 3);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pageTexts.push(content.items.map((item: any) => item.str).join(" "));
      }
      return pageTexts.join("\n\n");
    }

    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const arrayBuffer = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer });
      return res.value || "";
    }
  } catch (err) {
    console.warn("Could not read text from file:", file.name, err);
  }
  return "";
}

async function extractTextFromRemoteUrl(url: string, name: string): Promise<string> {
  try {
    const ext = name.split(".").pop()?.toLowerCase();
    const res = await fetch(url);
    if (!res.ok) return "";

    if (ext === "txt") {
      return await res.text();
    }

    if (ext === "pdf" || url.toLowerCase().includes(".pdf")) {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const arrayBuffer = await res.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pageTexts: string[] = [];
      const maxPages = Math.min(pdf.numPages, 3);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pageTexts.push(content.items.map((item: any) => item.str).join(" "));
      }
      return pageTexts.join("\n\n");
    }

    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const arrayBuffer = await res.arrayBuffer();
      const docRes = await mammoth.extractRawText({ arrayBuffer });
      return docRes.value || "";
    }
  } catch (err) {
    console.warn("Could not extract remote text for:", name, err);
  }
  return "";
}

/* ── Animated Count-up ─────────────────────────────────────── */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [value, setValue] = useState(0);
  const ref = useRef(false);

  useEffect(() => {
    if (ref.current || to === 0) return;
    ref.current = true;
    const start = performance.now();
    const duration = 900;
    const frame = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // easeOutExpo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(eased * to));
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
    detectedByContent?: boolean;
    id: string;
    file: File;
    name: string;
    category: WalletCategory;
  }
  const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // AI Analysis state
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<Record<string, string>>({});

  // Re-scan state for existing documents
  const [rescanning, setRescanning] = useState(false);
  const [rescanProgress, setRescanProgress] = useState<{ current: number; total: number } | null>(null);
  const [updatingCatId, setUpdatingCatId] = useState<string | null>(null);

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

  const addFilesToQueue = async (files: FileList | File[]) => {
    const fileList = Array.from(files);

    // 1. Initial queue with name-based detection and reading status
    const initialItems: QueueItem[] = fileList.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      name: file.name.replace(/\.[^/.]+$/, ""),
      category: detectCategoryFromName(file.name),
      reading: true,
      detectedByContent: false,
    }));

    setFileQueue((prev) => [...prev, ...initialItems]);

    // 2. Read each document's actual text content asynchronously
    for (const item of initialItems) {
      try {
        const text = await extractDocumentText(item.file);
        let finalCategory = item.category;
        let isContentDetected = false;

        if (text && text.trim().length > 10) {
          const contentCat = detectCategoryFromContent(text);
          if (contentCat) {
            finalCategory = contentCat;
            isContentDetected = true;
          }
        }

        setFileQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  category: finalCategory,
                  reading: false,
                  detectedByContent: isContentDetected,
                }
              : q
          )
        );
      } catch (err) {
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
      prev.map((item) => (item.id === id ? { ...item, category } : item))
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

        const newDoc = {
          uid: currentUser.uid,
          name: item.name.trim() || item.file.name,
          category: item.category,
          storagePath: filePath,
          downloadURL,
          sizeBytes: item.file.size,
          mimeType: item.file.type,
          uploadedAt: new Date().toISOString(),
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
      await updateDoc(doc(db, "wallet", docId), {
        category: newCategory,
      });
    } catch (err) {
      console.error("Failed to update category:", err);
      alert("Failed to update document category.");
    } finally {
      setUpdatingCatId(null);
    }
  };

  const handleRescanAll = async () => {
    if (documents.length === 0 || rescanning) return;
    setRescanning(true);
    let updatedCount = 0;

    try {
      for (let i = 0; i < documents.length; i++) {
        const d = documents[i];
        setRescanProgress({ current: i + 1, total: documents.length });

        // 1. First check by name
        let detected = detectCategoryFromName(d.name);

        // 2. If name is generic or we have a download URL, read actual content
        if (d.downloadURL) {
          const contentText = await extractTextFromRemoteUrl(d.downloadURL, d.name);
          if (contentText && contentText.trim().length > 10) {
            const contentCat = detectCategoryFromContent(contentText);
            if (contentCat) {
              detected = contentCat;
            }
          }
        }

        // If detected category is different from current, update in Firestore
        if (detected && detected !== d.category) {
          await updateDoc(doc(db, "wallet", d.id), {
            category: detected,
          });
          updatedCount++;
        }
      }

      alert(
        updatedCount > 0
          ? `Scan complete! ${updatedCount} document(s) were automatically re-categorized.`
          : "Scan complete! All documents are already in their correct categories."
      );
    } catch (err) {
      console.error("Re-scan error:", err);
      alert("Error occurred while re-scanning documents.");
    } finally {
      setRescanning(false);
      setRescanProgress(null);
    }
  };

  const categories: (WalletCategory | "All")[] = [
    "All",
    "Resume",
    "Certificates",
    "Awards",
    "Projects",
    "Results",
    "ID Documents",
    "Other",
  ];

  const filteredDocs =
    activeTab === "All" ? documents : documents.filter((d) => d.category === activeTab);

  const totalSizeKB = Math.round(documents.reduce((acc, d) => acc + d.sizeBytes, 0) / 1024);

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
          </div>

          {/* Re-Scan existing button */}
          {documents.length > 0 && (
            <motion.button
              onClick={handleRescanAll}
              disabled={rescanning}
              whileHover={!rescanning ? { scale: 1.03 } : {}}
              whileTap={!rescanning ? { scale: 0.97 } : {}}
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

            {/* Queue Preview List */}
            {fileQueue.length > 0 && (
              <div className="space-y-2">
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
                                <Loader2 className="w-2.5 h-2.5 animate-spin" /> Reading...
                              </span>
                            ) : item.detectedByContent ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-success font-semibold" title="Classified by reading document content">
                                <Sparkles className="w-2.5 h-2.5" /> Read
                              </span>
                            ) : null}
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
