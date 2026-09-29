"use client";

import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, getDocs, updateDoc, doc, onSnapshot } from "firebase/firestore";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAllowedAdminEmail } from "@/lib/adminConfig";
import {
  ShieldCheck,
  Building,
  Users,
  FileText,
  MessageSquare,
  CheckCircle,
  XCircle,
  FileSpreadsheet,
  Loader2,
  Cpu,
  RefreshCw,
  Layers,
  Zap,
  Flame,
  Clock,
  Activity,
  Check,
  Copy,
} from "lucide-react";
import type { OrgOpportunity, AdminStats, OrgRequest } from "@/lib/types";

export default function AdminPage() {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    totalOpportunities: 0,
    orgPostedCount: 0,
    seededCount: 0,
    totalApplications: 0,
    totalCommunityPosts: 0,
  });
  const [orgOpps, setOrgOpps] = useState<OrgOpportunity[]>([]);
  const [orgRequests, setOrgRequests] = useState<OrgRequest[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // AI Keys Double-Queue Bucket Telemetry
  const [telemetry, setTelemetry] = useState<any | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser || !isAllowedAdminEmail(currentUser.email)) {
      router.push("/dashboard");
    }
  }, [currentUser, authLoading, router]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isAllowedAdminEmail(currentUser.email)) return;

    // Load admin panel dashboard data
    const loadAdminData = async () => {
      try {
        // 1. Fetch Users
        const userSnap = await getDocs(collection(db, "users"));
        const users: any[] = [];
        userSnap.forEach((u) => users.push({ id: u.id, ...u.data() }));
        setUsersList(users);

        // 2. Fetch community posts
        const postSnap = await getDocs(collection(db, "community_posts"));
        let postCount = 0;
        postSnap.forEach(() => postCount++);

        // 3. Fetch applications
        const appSnap = await getDocs(collection(db, "applications"));
        let appCount = 0;
        appSnap.forEach(() => appCount++);

        // 4. Fetch Org Opportunities (for moderation)
        const orgOppQuery = query(collection(db, "org_opportunities"));
        const unsubOrgOpp = onSnapshot(orgOppQuery, (snap) => {
          const items: OrgOpportunity[] = [];
          snap.forEach((d) => {
            items.push({ id: d.id, ...d.data() } as OrgOpportunity);
          });
          setOrgOpps(items);

          const seededCount = items.filter((o: OrgOpportunity) => (o as any).source === "seed-india-2026").length;
          const automatedCount = items.filter((o: OrgOpportunity) => o.source === "automated").length;
          const orgPostedCount = items.length - seededCount - automatedCount;

          setStats({
            totalUsers: users.length,
            totalOpportunities: items.length,
            orgPostedCount,
            seededCount,
            totalApplications: appCount,
            totalCommunityPosts: postCount,
          });
          setLoading(false);
        });

        // 5. Fetch organization access requests (self-service signups)
        const orgReqQuery = query(collection(db, "org_requests"));
        const unsubOrgReq = onSnapshot(orgReqQuery, (snap) => {
          const items: OrgRequest[] = [];
          snap.forEach((d) => items.push(d.data() as OrgRequest));
          setOrgRequests(items);
        });

        return () => {
          unsubOrgOpp();
          unsubOrgReq();
        };
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };

    loadAdminData();
    fetchTelemetry();
  }, [currentUser]);

  const fetchTelemetry = async () => {
    try {
      setTelemetryLoading(true);
      const res = await fetch("/api/ai");
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data.telemetry);
      }
    } catch (e) {
      console.warn("Failed to fetch AI telemetry:", e);
    } finally {
      setTelemetryLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const updateOppStatus = async (oppId: string, status: "approved" | "rejected") => {
    try {
      await updateDoc(doc(db, "org_opportunities", oppId), {
        status,
      });
      setOrgOpps((prev) =>
        prev.map((opp) => (opp.id === oppId ? { ...opp, status } : opp))
      );
      alert(`Opportunity program has been successfully: ${status}! 🌸`);
    } catch (err) {
      console.error(err);
    }
  };

  const reviewOrgRequest = async (uid: string, decision: "approved" | "rejected") => {
    try {
      await updateDoc(doc(db, "org_requests", uid), {
        status: decision,
        reviewedAt: new Date().toISOString(),
      });
      if (decision === "approved") {
        await updateDoc(doc(db, "users", uid), { role: "organization" });
      }
      setOrgRequests((prev) =>
        prev.map((r) => (r.uid === uid ? { ...r, status: decision } : r))
      );
      alert(`Organization request ${decision}! 🌸`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRoleChange = async (uid: string, nextRole: "user" | "organization" | "admin") => {
    try {
      await updateDoc(doc(db, "users", uid), {
        role: nextRole,
      });
      setUsersList((prev) =>
        prev.map((u) => (u.id === uid ? { ...u, role: nextRole } : u))
      );
      setSelectedUser((prev: any) => (prev && prev.id === uid ? { ...prev, role: nextRole } : prev));
      alert(`User role updated to: ${nextRole}! 🌸`);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || authLoading || !currentUser || !isAllowedAdminEmail(currentUser.email)) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const pendingCount = orgOpps.filter((o) => o.status === "pending").length;
  const pendingOrgRequestsCount = orgRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" /> Admin Panel
        </h1>
        <p className="text-foreground-muted text-sm mt-1">
          Moderate organization postings, change user access permissions, and evaluate platform statistics.
        </p>
      </div>

      {/* Stats Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-border p-5 rounded-3xl shadow-sm text-center hover:shadow-[0_0_0_1px_rgba(255,92,134,0.15),0_4px_16px_rgba(255,60,110,0.1)] transition-shadow">
          <Users className="w-6 h-6 text-primary mx-auto mb-2" />
          <span className="block text-[9px] font-bold text-foreground-muted uppercase tracking-wider">Total Members</span>
          <span className="text-lg font-extrabold text-foreground">{stats.totalUsers} users</span>
        </div>
        <div className="bg-surface border border-border p-5 rounded-3xl shadow-sm text-center hover:shadow-[0_0_0_1px_rgba(255,92,134,0.15),0_4px_16px_rgba(255,60,110,0.1)] transition-shadow">
          <FileText className="w-6 h-6 text-blue-500 mx-auto mb-2" />
          <span className="block text-[9px] font-bold text-foreground-muted uppercase tracking-wider">Opportunities</span>
          <span className="text-lg font-extrabold text-foreground">{stats.totalOpportunities} total</span>
          <span className="block text-[9px] text-foreground-muted mt-0.5">
            {stats.orgPostedCount} org-posted · {stats.seededCount} seeded
          </span>
        </div>
        <div className="bg-surface border border-border p-5 rounded-3xl shadow-sm text-center hover:shadow-[0_0_0_1px_rgba(255,92,134,0.15),0_4px_16px_rgba(255,60,110,0.1)] transition-shadow">
          <FileSpreadsheet className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
          <span className="block text-[9px] font-bold text-foreground-muted uppercase tracking-wider">Applications</span>
          <span className="text-lg font-extrabold text-foreground">{stats.totalApplications} tracks</span>
        </div>
        <div className="bg-surface border border-border p-5 rounded-3xl shadow-sm text-center hover:shadow-[0_0_0_1px_rgba(255,92,134,0.15),0_4px_16px_rgba(255,60,110,0.1)] transition-shadow">
          <MessageSquare className="w-6 h-6 text-amber-500 mx-auto mb-2" />
          <span className="block text-[9px] font-bold text-foreground-muted uppercase tracking-wider">Forum Posts</span>
          <span className="text-lg font-extrabold text-foreground">{stats.totalCommunityPosts} posts</span>
        </div>
      </div>

      {/* ── AI Provider Keys & Double Queue Bucket Telemetry ── */}
      <div className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Cpu className="w-5 h-5" />
              </span>
              <div>
                <h3 className="font-extrabold text-foreground text-base flex items-center gap-2">
                  AI Key Engine — Double-Queue Bucket System
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Dual Failover Active
                  </span>
                </h3>
                <p className="text-xs text-foreground-muted">
                  Primary Queue processes all AI traffic. Secondary Queue remains on hot standby and activates upon 429/exhaustion.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchTelemetry}
              disabled={telemetryLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-raised hover:bg-border text-foreground rounded-xl text-xs font-bold transition-all border border-border disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${telemetryLoading ? "animate-spin text-primary" : ""}`} />
              Refresh Telemetry
            </button>
          </div>
        </div>

        {/* Global Key Bucket Metrics Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
          <div className="p-4 bg-surface-raised border border-border rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Total Pool Keys</span>
              <Layers className="w-4 h-4 text-primary" />
            </div>
            <div className="text-xl font-extrabold text-foreground mt-1">
              {telemetry?.totalKeys ?? 8} Keys
            </div>
            <span className="text-[10px] text-foreground-muted font-medium">
              4 Primary · 4 Standby Fallback
            </span>
          </div>

          <div className="p-4 bg-surface-raised border border-border rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Active Serving Queue</span>
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-xl font-extrabold text-emerald-500 mt-1">
              Queue {telemetry?.activeQueue ?? 1}
            </div>
            <span className="text-[10px] text-foreground-muted font-medium">
              {telemetry?.activeQueue === 1 ? "Primary traffic routing" : "Fallback active"}
            </span>
          </div>

          <div className="p-4 bg-surface-raised border border-border rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Total Tokens Processed</span>
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-xl font-extrabold text-amber-500 mt-1">
              {(telemetry?.summary?.totalEstimatedTokens ?? 0).toLocaleString()} tokens
            </div>
            <span className="text-[10px] text-foreground-muted font-medium">
              Across all requests
            </span>
          </div>

          <div className="p-4 bg-surface-raised border border-border rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Total AI Requests</span>
              <Flame className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl font-extrabold text-foreground mt-1">
              {telemetry?.summary?.totalRequests ?? 0}
            </div>
            <span className="text-[10px] text-emerald-500 font-semibold">
              {telemetry?.summary?.totalSuccessful ?? 0} ok · {telemetry?.summary?.totalFailed ?? 0} retried
            </span>
          </div>
        </div>

        {/* 2 Bucket Queues Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
          {/* Active Serving Bucket */}
          <div className="p-5 bg-surface-raised border border-border rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h4 className="font-extrabold text-foreground text-sm">
                  {telemetry?.primaryBucket?.name || "Active Serving Bucket"}
                </h4>
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                {telemetry?.primaryBucket?.status || "Serving Traffic"}
              </span>
            </div>

            <p className="text-[11px] text-foreground-muted">
              Remaining in active bucket: <strong className="text-foreground">{telemetry?.primaryBucket?.keysRemaining ?? 8} keys</strong>. Har fallback/rate limit par key eject hokar standby bucket me transfer hoti hai.
            </p>

            <div className="space-y-2.5">
              {(telemetry?.primaryBucket?.keys || []).map((k: any) => (
                <div
                  key={k.keyId}
                  className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => copyToClipboard(k.keyId, k.keyId)}
                      className="p-1 text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded transition-colors"
                      title="Copy Key Identifier"
                    >
                      {copiedKeyId === k.keyId ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <div>
                      <span className="font-bold text-foreground block truncate flex items-center gap-1.5">
                        {k.keyId}
                        {k.keyId === "OPENROUTER_API_KEY_8" && (
                          <span className="text-[8px] bg-primary/10 text-primary px-1.5 py-0.2 rounded font-semibold border border-primary/20">
                            NEW
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-foreground-muted font-mono">{k.maskedKey}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[11px] font-extrabold text-foreground block">
                      {(k.estimatedTokens || 0).toLocaleString()} tokens
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase border ${
                      k.status === "in_use"
                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        : k.status === "cooling_down"
                        ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                        : "bg-surface-raised text-foreground-muted border-border"
                    }`}>
                      {k.status}
                    </span>
                  </div>
                </div>
              ))}

              {(!telemetry?.primaryBucket?.keys || telemetry?.primaryBucket?.keys?.length === 0) && (
                <div className="text-center py-8 text-foreground-muted text-xs">
                  All keys ejected from active bucket. Automatic swap triggered!
                </div>
              )}
            </div>
          </div>

          {/* Standby / Replenishing Bucket */}
          <div className="p-5 bg-surface-raised border border-border rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <h4 className="font-extrabold text-foreground text-sm">
                  {telemetry?.fallbackBucket?.name || "Standby / Replenishing Bucket"}
                </h4>
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-500 border-blue-500/20">
                {telemetry?.fallbackBucket?.status || "Filling on Fallback"}
              </span>
            </div>

            <p className="text-[11px] text-foreground-muted">
              Keys in holding/cooldown: <strong className="text-foreground">{telemetry?.fallbackBucket?.keysCount ?? 0} keys</strong>. Jab tak active bucket 0 nahi hoti, yahan se koi key consume nahi hogi.
            </p>

            <div className="space-y-2.5">
              {(telemetry?.fallbackBucket?.keys || []).map((k: any) => (
                <div
                  key={k.keyId}
                  className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => copyToClipboard(k.keyId, k.keyId)}
                      className="p-1 text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded transition-colors"
                      title="Copy Key Identifier"
                    >
                      {copiedKeyId === k.keyId ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <div>
                      <span className="font-bold text-foreground block truncate flex items-center gap-1.5">
                        {k.keyId}
                      </span>
                      <span className="text-[10px] text-foreground-muted font-mono">{k.maskedKey}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[11px] font-extrabold text-foreground block">
                      {(k.estimatedTokens || 0).toLocaleString()} tokens
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase border bg-amber-500/10 text-amber-500 border-amber-500/20">
                      Cooldown / Standby
                    </span>
                  </div>
                </div>
              ))}

              {(!telemetry?.fallbackBucket?.keys || telemetry?.fallbackBucket?.keys?.length === 0) && (
                <div className="text-center py-8 text-foreground-muted text-xs border border-dashed border-border rounded-xl">
                  Bucket is currently empty. Keys will move here as fallback occurs.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Moderate Opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Organization access requests */}
        <div className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-6">
          <h3 className="font-extrabold text-foreground text-sm flex items-center justify-between">
            <span>Organization requests</span>
            {pendingOrgRequestsCount > 0 && (
              <span className="text-[9px] font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
                {pendingOrgRequestsCount} Pending
              </span>
            )}
          </h3>

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
            {orgRequests.map((req) => (
              <div key={req.uid} className="p-4 bg-surface-raised border border-border rounded-2xl space-y-3">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <span className="text-[8px] font-extrabold uppercase tracking-wider text-foreground-muted">
                      {req.requesterName} · {req.requesterEmail}
                    </span>
                    <h5 className="font-bold text-foreground text-xs mt-1 leading-snug">{req.orgName}</h5>
                    {req.website && (
                      <a href={req.website} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline">
                        {req.website}
                      </a>
                    )}
                  </div>
                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                    req.status === "approved"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      : req.status === "rejected"
                      ? "bg-red-500/10 text-red-500 border-red-500/20"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  }`}>
                    {req.status}
                  </span>
                </div>

                <p className="text-[11px] text-foreground-muted line-clamp-3 leading-relaxed">{req.description}</p>

                {req.status === "pending" && (
                  <div className="flex gap-2 justify-end pt-2 border-t border-border">
                    <button
                      onClick={() => reviewOrgRequest(req.uid, "approved")}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-xl text-[10px] font-bold transition-all border border-emerald-500/20"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => reviewOrgRequest(req.uid, "rejected")}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl text-[10px] font-bold transition-all border border-red-500/20"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}

            {orgRequests.length === 0 && (
              <div className="text-center py-12">
                <Building className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
                <h5 className="font-bold text-foreground text-xs">No requests yet</h5>
                <p className="text-foreground-muted text-[10px] mt-1">
                  When users request organization access, they&apos;ll show up here.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-6">
          <h3 className="font-extrabold text-foreground text-sm flex items-center justify-between">
            <span>Moderate org opportunities</span>
            {pendingCount > 0 && (
              <span className="text-[9px] font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
                {pendingCount} Pending Approval
              </span>
            )}
          </h3>

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
            {orgOpps.map((opp) => (
              <div key={opp.id} className="p-4 bg-surface-raised border border-border rounded-2xl space-y-3">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <span className="text-[8px] font-extrabold uppercase tracking-wider text-foreground-muted">
                      Posted by {opp.orgName}
                      {opp.source === "automated" && (
                        <span className="ml-1.5 text-[7px] font-bold bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded border border-blue-500/20 normal-case tracking-normal">
                          Auto-ingested{opp.sourceType === "scraped" ? " · scraped" : " · trusted feed"}
                        </span>
                      )}
                    </span>
                    <h5 className="font-bold text-foreground text-xs mt-1 leading-snug">{opp.title}</h5>
                  </div>
                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                    opp.status === "approved"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      : opp.status === "rejected"
                      ? "bg-red-500/10 text-red-500 border-red-500/20"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  }`}>
                    {opp.status}
                  </span>
                </div>

                <p className="text-[11px] text-foreground-muted line-clamp-2 leading-relaxed">{opp.description}</p>

                {opp.status === "pending" && (
                  <div className="flex gap-2 justify-end pt-2 border-t border-border">
                    <button
                      onClick={() => updateOppStatus(opp.id, "approved")}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-xl text-[10px] font-bold transition-all border border-emerald-500/20"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => updateOppStatus(opp.id, "rejected")}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl text-[10px] font-bold transition-all border border-red-500/20"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}

            {orgOpps.length === 0 && (
              <div className="text-center py-12">
                <Building className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
                <h5 className="font-bold text-foreground text-xs">No programs to review</h5>
                <p className="text-foreground-muted text-[10px] mt-1">
                  Once organizations publish opportunities, they will list here for approval.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* User permissions moderator */}
        <div className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-6">
          <h3 className="font-extrabold text-foreground text-sm">Manage Member Roles</h3>

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
            {usersList.map((usr) => (
              <button
                key={usr.id}
                onClick={() => setSelectedUser(usr)}
                className="w-full p-4 bg-surface-raised border border-border rounded-2xl flex items-center justify-between gap-4 text-left hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <h5 className="font-bold text-foreground text-xs truncate">{usr.name || "Unnamed User"}</h5>
                <span className={`shrink-0 text-[8px] font-bold uppercase px-2 py-1 rounded-full border ${
                  usr.role === "admin"
                    ? "bg-primary/10 text-primary border-primary/20"
                    : usr.role === "organization"
                    ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                    : "bg-slate-500/10 text-slate-500 border-slate-500/20"
                }`}>
                  {usr.role || "user"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* User details modal */}
      {selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedUser(null)}
        >
          <div
            className="bg-surface border border-border rounded-3xl shadow-xl max-w-md w-full p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-extrabold text-foreground text-lg">{selectedUser.name || "Unnamed User"}</h3>
                <p className="text-xs text-foreground-muted mt-0.5">{selectedUser.email || "No email on file"}</p>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="p-1.5 text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded-lg transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-surface-raised p-3 rounded-2xl">
                <span className="block text-[9px] font-bold text-foreground-muted uppercase mb-1">Joined</span>
                <span className="font-semibold text-foreground">
                  {selectedUser.createdAt
                    ? new Date(selectedUser.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : "Unknown"}
                </span>
              </div>
              <div className="bg-surface-raised p-3 rounded-2xl">
                <span className="block text-[9px] font-bold text-foreground-muted uppercase mb-1">Location</span>
                <span className="font-semibold text-foreground">{selectedUser.location || "—"}</span>
              </div>
              <div className="bg-surface-raised p-3 rounded-2xl">
                <span className="block text-[9px] font-bold text-foreground-muted uppercase mb-1">Education</span>
                <span className="font-semibold text-foreground">{selectedUser.education || "—"}</span>
              </div>
              <div className="bg-surface-raised p-3 rounded-2xl">
                <span className="block text-[9px] font-bold text-foreground-muted uppercase mb-1">Category</span>
                <span className="font-semibold text-foreground">{selectedUser.category || "—"}</span>
              </div>
            </div>

            {selectedUser.bio && (
              <div>
                <span className="block text-[9px] font-bold text-foreground-muted uppercase mb-1">Bio</span>
                <p className="text-xs text-foreground leading-relaxed">{selectedUser.bio}</p>
              </div>
            )}

            <div className="pt-3 border-t border-border">
              <span className="block text-[9px] font-bold text-foreground-muted uppercase mb-2">Access Level</span>
              <select
                value={selectedUser.role || "user"}
                onChange={(e) => handleRoleChange(selectedUser.id, e.target.value as any)}
                disabled={isAllowedAdminEmail(selectedUser.email)}
                className="w-full text-xs font-bold p-2.5 bg-surface-raised border border-border rounded-xl outline-none text-foreground focus:border-primary disabled:opacity-50"
              >
                <option value="user">User</option>
                <option value="organization">Organization</option>
                {selectedUser.role === "admin" && <option value="admin">Admin</option>}
              </select>
              {isAllowedAdminEmail(selectedUser.email) && (
                <p className="text-[10px] text-foreground-muted mt-1.5">
                  This user&apos;s admin access is locked via the hardcoded allowlist and can&apos;t be changed here.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
