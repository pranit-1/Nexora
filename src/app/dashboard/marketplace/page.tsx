"use client";

import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  orderBy,
  addDoc,
  updateDoc,
  doc,
  increment,
  onSnapshot,
} from "firebase/firestore";
import { useState, useEffect, useRef } from "react";
import {
  ShoppingBag,
  Plus,
  Tag,
  Search,
  BookOpen,
  Code2,
  DollarSign,
  Heart,
  Loader2,
  Send,
  ExternalLink,
} from "lucide-react";
import type { MarketplaceListing, MarketplaceCategory } from "@/lib/types";
import { motion, AnimatePresence, type Variants } from "framer-motion";

/* ── Animation Variants ─────────────────────────────────────── */
const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, x: -16, scale: 0.96, transition: { duration: 0.2 } },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, x: -18 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

/* ── Animated Count-up ─────────────────────────────────────── */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [value, setValue] = useState(0);
  const ref = useRef(false);

  useEffect(() => {
    if (ref.current || to === 0) {
      setValue(to);
      return;
    }
    ref.current = true;
    const start = performance.now();
    const duration = 800;
    const frame = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(eased * to));
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [to]);

  return <>{value}{suffix}</>;
}

const CATEGORIES: MarketplaceCategory[] = [
  "All",
  "Study Notes",
  "Project Templates",
  "Freelance Services",
  "Mentorship",
  "Resume Templates",
  "Code Snippets",
  "Other",
];

export default function MarketplacePage() {
  const { currentUser, profile } = useAuth();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<MarketplaceCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});

  // Form states
  const [posting, setPosting] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<MarketplaceCategory>("Study Notes");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState<number>(0);
  const [contactLink, setContactLink] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  useEffect(() => {
    const q = query(collection(db, "marketplace_listings"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: MarketplaceListing[] = [];
        snap.forEach((d) => {
          items.push({ id: d.id, ...d.data() } as MarketplaceListing);
        });
        setListings(items);
        setLoading(false);
      },
      (err) => {
        console.warn("Marketplace fetch:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handlePostListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      alert("Please login to post a listing.");
      return;
    }
    if (!title.trim() || !description.trim()) {
      alert("Please provide both title and description.");
      return;
    }

    setPosting(true);
    try {
      const parsedTags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const author = profile?.name || currentUser.displayName || currentUser.email?.split("@")[0] || "Student";

      const newListing = {
        uid: currentUser.uid,
        authorName: author,
        authorEmail: currentUser.email || "",
        title: title.trim(),
        description: description.trim(),
        category,
        price: Number(price) || 0,
        currency: "INR",
        tags: parsedTags,
        contactLink: contactLink.trim() || "",
        likes: 0,
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, "marketplace_listings"), newListing);

      setTitle("");
      setDescription("");
      setPrice(0);
      setContactLink("");
      setTagsInput("");
      setCategory("Study Notes");
    } catch (err: any) {
      console.error("Post listing error:", err);
      alert(err.message || "Failed to post listing.");
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (listingId: string) => {
    if (likedMap[listingId]) return;
    setLikedMap((prev) => ({ ...prev, [listingId]: true }));

    // Optimistic state update
    setListings((prev) =>
      prev.map((l) => (l.id === listingId ? { ...l, likes: (l.likes || 0) + 1 } : l))
    );

    try {
      const docRef = doc(db, "marketplace_listings", listingId);
      await updateDoc(docRef, {
        likes: increment(1),
      });
    } catch (err) {
      console.error("Like error:", err);
    }
  };

  const filteredListings = listings.filter((item) => {
    const matchCat = activeCategory === "All" || item.category === activeCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.tags?.some((t) => t.toLowerCase().includes(q)) ||
      item.authorName?.toLowerCase().includes(q);

    return matchCat && matchSearch;
  });

  const freeCount = listings.filter((l) => Number(l.price) === 0).length;

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
      className="max-w-6xl mx-auto space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* Header + Stats */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
          <ShoppingBag className="w-6 h-6 text-primary" /> Student Marketplace
        </h1>
        <p className="text-foreground-muted text-sm mt-1">
          Share or discover study notes, project templates, mentorship sessions, and freelance services across the NEXORA community.
        </p>

        <div className="flex gap-3 mt-4 flex-wrap">
          {[
            { label: "Total Listings", value: listings.length, suffix: "" },
            { label: "Free Resources", value: freeCount, suffix: "" },
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
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Post a Listing */}
        <motion.div
          variants={panelVariants}
          className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-4 h-fit"
        >
          <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-primary" /> Post a Listing
          </h3>

          <form onSubmit={handlePostListing} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
                Title *
              </label>
              <input
                type="text"
                placeholder="e.g. Complete DSA Notes & Handwritten Cheatsheet"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full text-xs p-3 border border-border rounded-xl outline-none focus:border-primary bg-background text-foreground placeholder:text-foreground-muted transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MarketplaceCategory)}
                className="w-full text-xs p-3 border border-border rounded-xl outline-none focus:border-primary bg-background text-foreground transition-all"
              >
                {CATEGORIES.filter((c) => c !== "All").map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
                Description *
              </label>
              <textarea
                rows={3}
                placeholder="Describe what you are offering, key highlights, and deliverables..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="w-full text-xs p-3 border border-border rounded-xl outline-none focus:border-primary bg-background text-foreground placeholder:text-foreground-muted transition-all resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
                  Price (INR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-xs text-foreground-muted">₹</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="0 = Free"
                    value={price === 0 ? "" : price}
                    onChange={(e) => setPrice(Number(e.target.value) || 0)}
                    className="w-full text-xs p-3 pl-7 border border-border rounded-xl outline-none focus:border-primary bg-background text-foreground placeholder:text-foreground-muted transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
                  Contact / Link
                </label>
                <input
                  type="text"
                  placeholder="URL / GitHub / Social"
                  value={contactLink}
                  onChange={(e) => setContactLink(e.target.value)}
                  className="w-full text-xs p-3 border border-border rounded-xl outline-none focus:border-primary bg-background text-foreground placeholder:text-foreground-muted transition-all"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
                Tags (comma separated)
              </label>
              <input
                type="text"
                placeholder="dsa, python, notes, beginner"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full text-xs p-3 border border-border rounded-xl outline-none focus:border-primary bg-background text-foreground placeholder:text-foreground-muted transition-all"
              />
            </div>

            <motion.button
              type="submit"
              disabled={posting}
              whileHover={!posting ? { scale: 1.02 } : {}}
              whileTap={!posting ? { scale: 0.98 } : {}}
              className="w-full py-3 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 mt-2"
            >
              {posting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Post Listing
                </>
              )}
            </motion.button>
          </form>
        </motion.div>

        {/* Right Column: Marketplace Area */}
        <motion.div className="lg:col-span-2 space-y-6" variants={itemVariants}>
          {/* Search bar & Category filter tabs */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-foreground-muted absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search resources, templates, authors, tags..."
                className="w-full text-xs pl-10 pr-4 py-3 border border-border rounded-2xl outline-none focus:border-primary bg-surface text-foreground placeholder:text-foreground-muted shadow-sm transition-all"
              />
            </div>

            {/* Category tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1 border-b border-border relative">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`pb-3 px-2 text-xs font-semibold whitespace-nowrap transition-all relative ${
                    activeCategory === cat ? "text-primary" : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {cat}
                  {activeCategory === cat && (
                    <motion.span
                      layoutId="marketplace-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                      transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Listings Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredListings.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  variants={itemVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  whileHover={{
                    boxShadow:
                      "0 0 0 1px rgba(255,92,134,0.2), 0 8px 24px rgba(255,60,110,0.12)",
                  }}
                  className="p-5 bg-surface border border-border rounded-3xl shadow-sm flex flex-col justify-between gap-3 transition-shadow"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                        {item.category}
                      </span>
                      <span
                        className={`text-xs font-extrabold px-2 py-0.5 rounded-lg ${
                          Number(item.price) === 0
                            ? "bg-success/10 text-success border border-success/20"
                            : "bg-surface-raised text-foreground font-bold border border-border"
                        }`}
                      >
                        {Number(item.price) === 0 ? "FREE" : `₹${item.price}`}
                      </span>
                    </div>

                    <h4 className="font-bold text-foreground text-sm leading-snug line-clamp-2">
                      {item.title}
                    </h4>

                    <p className="text-[11px] text-foreground-muted leading-relaxed line-clamp-3">
                      {item.description}
                    </p>

                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {item.tags.slice(0, 4).map((tag, idx) => (
                          <span
                            key={idx}
                            className="text-[9px] px-1.5 py-0.5 rounded-md bg-surface-raised text-foreground-muted border border-border"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border flex items-center justify-between text-xs">
                    <span className="text-[10px] text-foreground-muted font-medium">
                      by <span className="font-semibold text-foreground">{item.authorName}</span>
                    </span>

                    <div className="flex items-center gap-2">
                      {item.contactLink && (
                        <a
                          href={
                            item.contactLink.startsWith("http")
                              ? item.contactLink
                              : `https://${item.contactLink}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-foreground-muted hover:text-primary hover:bg-surface-raised transition-colors"
                          title="Open Link"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      <motion.button
                        onClick={() => handleLike(item.id)}
                        whileTap={{ scale: 0.88 }}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          likedMap[item.id]
                            ? "bg-danger/10 text-danger"
                            : "text-foreground-muted hover:text-danger hover:bg-surface-raised"
                        }`}
                      >
                        <Heart
                          className={`w-3.5 h-3.5 ${
                            likedMap[item.id] ? "fill-danger text-danger" : ""
                          }`}
                        />
                        <span>{item.likes || 0}</span>
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}

              {filteredListings.length === 0 && (
                <motion.div
                  key="no-items"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="col-span-full py-16 text-center bg-surface border border-border rounded-3xl"
                >
                  <BookOpen className="w-10 h-10 text-foreground-muted mx-auto mb-2 opacity-50" />
                  <h4 className="font-bold text-foreground text-sm">No marketplace items yet</h4>
                  <p className="text-foreground-muted text-xs mt-1 max-w-sm mx-auto">
                    Be the first to list a resource, study note, or template using the form on the left!
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
