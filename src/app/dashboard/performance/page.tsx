"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function PerformanceRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/ai-hub?tab=analytics");
  }, [router]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-secondary" />
      <p className="text-sm text-foreground-muted">Redirecting to AI Hub Performance Tracker…</p>
    </div>
  );
}