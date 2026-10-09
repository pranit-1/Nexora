// OpenRouter API key rotator and request service (Double Queue Alternating Bucket System).
// Bucket Architecture:
// - Queue-A (Primary Bucket): Starts full with all configured keys.
// - Queue-B (Standby / Replenishing Bucket): Starts completely empty.
// - Workflow: Active bucket keys serve requests. Whenever a key hits 429/error, it is EJECTED from the
//   active bucket and transferred to the standby bucket for cooldown.
// - Zero Leakage Rule: The standby bucket is NEVER touched until the active bucket is COMPLETELY EMPTY.
// - When the active bucket reaches 0 keys, roles instantly SWAP (Standby becomes Active, and the old bucket becomes the new empty bucket).

import { aiFormatError, isAiFormatError, parseJsonLoose } from "./json";

export interface KeyTelemetry {
  index: number;
  keyId: string;
  maskedKey: string;
  currentBucket: "Queue-A (Active)" | "Queue-B (Replenishing)" | "Queue-B (Active)" | "Queue-A (Replenishing)";
  status: "idle" | "in_use" | "cooling_down" | "exhausted";
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  estimatedTokens: number;
  lastUsedAt?: string;
  cooldownUntil?: number;
}

export class OpenRouterService {
  private static telemetry: Map<number, KeyTelemetry> = new Map();

  // Dynamic Double-Queue State
  private static activeBucket: "A" | "B" = "A";
  private static queueA: number[] = [];
  private static queueB: number[] = [];
  private static initialized = false;

  /**
   * Upstream timeout. Without one, a connection that is accepted but never
   * answered holds the request open until the platform kills it, and the key is
   * counted as neither success nor failure.
   */
  private static get timeoutMs(): number {
    const raw = Number(process.env.AI_REQUEST_TIMEOUT_MS);
    return Number.isFinite(raw) && raw >= 1_000 ? raw : 45_000;
  }

  public static getAllKeys(): string[] {
    const indexed: string[] = [];
    for (let i = 1; i <= 16; i++) {
      const k = process.env[`OPENROUTER_API_KEY_${i}` as keyof NodeJS.ProcessEnv] as string | undefined;
      if (k && k.trim().length > 10) indexed.push(k.trim());
    }
    if (indexed.length > 0) return indexed;
    const keysStr = process.env.OPENROUTER_API_KEYS || "";
    return keysStr
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 10);
  }

  /**
   * Initializes Double Queue Buckets:
   * Starts with Queue-A FULL of all keys [0..N-1], and Queue-B completely EMPTY.
   */
  private static initQueues() {
    if (this.initialized) return;
    const keys = this.getAllKeys();
    this.queueA = keys.map((_, i) => i);
    this.queueB = [];
    this.activeBucket = "A";

    keys.forEach((key, index) => {
      this.telemetry.set(index, {
        index,
        keyId: `OPENROUTER_API_KEY_${index + 1}`,
        maskedKey: this.maskKey(key),
        currentBucket: "Queue-A (Active)",
        status: "idle",
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        estimatedTokens: 0,
      });
    });

    this.initialized = true;
  }

  private static maskKey(key: string): string {
    if (key.length <= 12) return "******";
    return `${key.slice(0, 8)}...${key.slice(-6)}`;
  }

  private static getModel(): string {
    return process.env.OPENROUTER_MODEL || "openrouter/free";
  }

  private static getVisionModel(): string {
    const model = process.env.OPENROUTER_VISION_MODEL;
    if (!model || model.trim().length === 0) {
      throw new Error("No vision model configured. Set OPENROUTER_VISION_MODEL to enable image analysis.");
    }
    return model;
  }

  /**
   * Eject key from active bucket into the fallback bucket upon 429/error.
   */
  private static ejectKeyToFallback(keyIndex: number, cooldownSeconds: number = 30) {
    const tel = this.telemetry.get(keyIndex);
    if (tel) {
      tel.status = "cooling_down";
      tel.cooldownUntil = Date.now() + cooldownSeconds * 1000;
    }

    if (this.activeBucket === "A") {
      this.queueA = this.queueA.filter((idx) => idx !== keyIndex);
      if (!this.queueB.includes(keyIndex)) {
        this.queueB.push(keyIndex);
      }
      if (tel) tel.currentBucket = "Queue-B (Replenishing)";
      console.warn(`[OpenRouterService] ⚠️ Key #${keyIndex + 1} ejected from Queue-A -> transferred to Queue-B. Remaining in Queue-A: ${this.queueA.length}`);
    } else {
      this.queueB = this.queueB.filter((idx) => idx !== keyIndex);
      if (!this.queueA.includes(keyIndex)) {
        this.queueA.push(keyIndex);
      }
      if (tel) tel.currentBucket = "Queue-A (Replenishing)";
      console.warn(`[OpenRouterService] ⚠️ Key #${keyIndex + 1} ejected from Queue-B -> transferred to Queue-A. Remaining in Queue-B: ${this.queueB.length}`);
    }
  }

  /**
   * A key is only allowed to serve once its cooldown has elapsed.
   */
  private static isCoolingDown(index: number): boolean {
    const tel = this.telemetry.get(index);
    if (!tel?.cooldownUntil) return false;
    return tel.cooldownUntil > Date.now();
  }

  /** Milliseconds until the earliest key becomes usable again. */
  private static shortestCooldownMs(): number {
    const now = Date.now();
    let shortest = Infinity;
    for (const tel of this.telemetry.values()) {
      if (tel.cooldownUntil && tel.cooldownUntil > now) {
        shortest = Math.min(shortest, tel.cooldownUntil - now);
      }
    }
    return shortest === Infinity ? 0 : shortest;
  }

  /** First key in `list` that is actually allowed to serve right now. */
  private static firstEligible(list: number[]): number | undefined {
    return list.find((index) => !this.isCoolingDown(index));
  }

  /**
   * Check if active bucket has a usable key. If not, trigger full failover swap
   * to the standby bucket. Returns false only when both buckets have 0 eligible keys.
   */
  private static ensureActiveBucket(): boolean {
    const currentActiveList = this.activeBucket === "A" ? this.queueA : this.queueB;

    // 1. If active bucket has an eligible key right now, proceed
    if (this.firstEligible(currentActiveList) !== undefined) {
      return true;
    }

    // 2. If active bucket has no eligible keys (or is completely empty): Swap roles!
    const nextBucket = this.activeBucket === "A" ? "B" : "A";
    const nextList = nextBucket === "A" ? this.queueA : this.queueB;

    if (nextList.length > 0) {
      console.log(`[OpenRouterService] 🔄 Active Queue-${this.activeBucket} empty/cooling down! Swapping to Queue-${nextBucket} (${nextList.length} keys).`);
      this.activeBucket = nextBucket;

      // Update telemetry labels
      nextList.forEach((idx) => {
        const tel = this.telemetry.get(idx);
        if (tel) {
          tel.currentBucket = `${nextBucket === "A" ? "Queue-A" : "Queue-B"} (Active)` as any;
          if (!this.isCoolingDown(idx)) tel.status = "idle";
        }
      });

      // If any key is ready in the swapped queue, proceed
      if (this.firstEligible(nextList) !== undefined) {
        return true;
      }
    }

    // If both queues are cooling down, check if active bucket has any key whose cooldown is almost done
    return false;
  }

  /**
   * Returns current telemetry and queue status for Admin Dashboard.
   */
  public static getTelemetryData() {
    this.initQueues();
    const items = Array.from(this.telemetry.values());

    const activeList = this.activeBucket === "A" ? this.queueA : this.queueB;
    const standbyList = this.activeBucket === "A" ? this.queueB : this.queueA;

    return {
      activeQueue: this.activeBucket,
      totalKeys: items.length,
      primaryBucket: {
        name: `Bucket ${this.activeBucket} (Active Serving)`,
        keysRemaining: activeList.length,
        status: activeList.length > 0 ? "Active Serving" : "Empty (Swapping)",
        keys: activeList.map((idx) => items.find((k) => k.index === idx)!),
      },
      fallbackBucket: {
        name: `Bucket ${this.activeBucket === "A" ? "B" : "A"} (Replenishing Standby)`,
        keysCount: standbyList.length,
        status: standbyList.length > 0 
          ? (activeList.length === 0 ? "Swapping to Active" : "Filling on fallback (Locked until Active is empty)") 
          : "Empty (Pristine)",
        keys: standbyList.map((idx) => items.find((k) => k.index === idx)!),
      },
      allKeys: items,
      summary: {
        totalRequests: items.reduce((acc, k) => acc + k.totalRequests, 0),
        totalSuccessful: items.reduce((acc, k) => acc + k.successfulRequests, 0),
        totalFailed: items.reduce((acc, k) => acc + k.failedRequests, 0),
        totalEstimatedTokens: items.reduce((acc, k) => acc + k.estimatedTokens, 0),
      },
    };
  }

  public static async request(prompt: string, jsonMode: boolean = false): Promise<any> {
    return this.send(prompt, jsonMode);
  }

  /** Vision variant. Requires OPENROUTER_VISION_MODEL to be set. */
  public static async requestVision(
    prompt: string,
    imageBase64: string,
    mimeType: string = "image/jpeg",
    jsonMode: boolean = false
  ): Promise<any> {
    return this.send(prompt, jsonMode, { imageBase64, mimeType });
  }

  private static async send(
    prompt: string,
    jsonMode: boolean = false,
    image?: { imageBase64: string; mimeType: string }
  ): Promise<any> {
    const keys = this.getAllKeys();
    if (keys.length === 0) {
      throw new Error("No OpenRouter API keys found. Please set OPENROUTER_API_KEYS in your environment.");
    }

    this.initQueues();
    const model = image ? this.getVisionModel() : this.getModel();
    let attempts = 0;
    // One pass over every key plus one retry pass, since a key can fail
    // transiently without being exhausted.
    const maxAttempts = keys.length * 2;
    let lastError = "";

    while (attempts < maxAttempts) {
      const hasAvailable = this.ensureActiveBucket();
      if (!hasAvailable) {
        const waitMs = this.shortestCooldownMs();
        if (waitMs > 0 && waitMs <= 4000) {
          await new Promise((r) => setTimeout(r, waitMs + 200));
          attempts++;
          continue;
        }
        throw new Error(
          `OpenRouter API rate limit reached. Next available key frees up in ${Math.ceil(waitMs / 1000)}s.`
        );
      }

      // Pick the first key currently allowed to serve at the front of the active bucket
      const activeList = this.activeBucket === "A" ? this.queueA : this.queueB;
      const keyIndex = this.firstEligible(activeList);
      if (keyIndex === undefined) {
        // ensureActiveBucket already returned true, so this is unreachable in
        // practice; fail closed rather than indexing with undefined.
        attempts++;
        continue;
      }
      const activeKey = keys[keyIndex];
      const maskedKey = this.maskKey(activeKey);
      const tel = this.telemetry.get(keyIndex)!;

      tel.status = "in_use";
      tel.totalRequests++;
      tel.lastUsedAt = new Date().toISOString();

      const url = "https://openrouter.ai/api/v1/chat/completions";
      console.log(`[OpenRouterService] [Queue-${this.activeBucket} Active] Request using key #${keyIndex + 1} (${maskedKey}). Bucket remaining: ${activeList.length}`);

      try {
        const content: any = image
          ? [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.imageBase64}` } },
            ]
          : prompt;

        const body: any = {
          model,
          messages: [{ role: "user", content }],
        };

        if (jsonMode) {
          body.response_format = { type: "json_object" };
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeKey}`,
        };

        if (process.env.NEXT_PUBLIC_APP_URL) {
          headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL;
        }
        if (process.env.NEXT_PUBLIC_APP_NAME) {
          headers["X-Title"] = process.env.NEXT_PUBLIC_APP_NAME;
        }

        const timeoutMs = this.timeoutMs;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        const promptTokens = Math.ceil(prompt.length / 4);

        if (response.status === 429) {
          console.warn(`[OpenRouterService] Key #${keyIndex + 1} (${maskedKey}) rate limited (429). Ejecting to fallback bucket.`);
          tel.failedRequests++;
          this.ejectKeyToFallback(keyIndex, 3);
          attempts++;
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[OpenRouterService] Key #${keyIndex + 1} (${maskedKey}) failed status ${response.status}: ${errText}. Ejecting.`);
          tel.failedRequests++;
          this.ejectKeyToFallback(keyIndex, response.status === 401 ? 60 : 3);
          attempts++;
          continue;
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;

        if (!text || text.trim().length === 0) {
          console.warn(`[OpenRouterService] Key #${keyIndex + 1} returned empty content.`);
          tel.failedRequests++;
          this.ejectKeyToFallback(keyIndex, 2);
          attempts++;
          continue;
        }

        // Record successful token consumption
        const completionTokens = Math.ceil(text.length / 4);
        const actualUsage = data?.usage?.total_tokens || (promptTokens + completionTokens);
        tel.estimatedTokens += actualUsage;
        tel.successfulRequests++;
        tel.status = "idle";

        if (jsonMode) {
          // The key just answered 200 with a valid body, so it is healthy. If the
          // payload is not JSON that is the model ignoring `response_format`, not
          // a key fault — the old code ejected the key anyway, which burned a
          // working credential on a formatting problem and masked the real cause
          // behind "all keys failed". Salvage first, then fail loudly.
          const parsed = parseJsonLoose(text);
          if (parsed === undefined) {
            tel.failedRequests++;
            tel.status = "idle";
            throw aiFormatError(
              "The AI model returned a non-JSON response for a JSON request. The key is healthy; the model's output format is not."
            );
          }
          return parsed;
        }

        return text;
      } catch (err: any) {
        // A format failure is a request bug, not a key fault: rethrow without
        // ejecting so one bad key cannot cascade into a total outage.
        if (isAiFormatError(err)) {
          throw err;
        }
        const isTimeout = err?.name === "AbortError";
        lastError = isTimeout
          ? `timed out after ${this.timeoutMs}ms`
          : err?.message || String(err);
        console.error(
          `[OpenRouterService] ${isTimeout ? "Timeout" : "Connection error"} with key #${keyIndex + 1}:`,
          lastError
        );
        tel.failedRequests++;
        // A timeout means the credential authenticated fine but the upstream was
        // slow, so cool it down briefly instead of parking it for minutes.
        this.ejectKeyToFallback(keyIndex, isTimeout ? 1 : 3);
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(
            `All available OpenRouter keys failed. Last error: ${lastError}`
          );
        }
      }
    }

    throw new Error(
      lastError
        ? `All available OpenRouter keys failed. Last error: ${lastError}`
        : "OpenRouter request failed across alternating queue cycles."
    );
  }
}
