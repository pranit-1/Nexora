// OpenRouter API key rotator and request service (backup AI provider).
// Supported environment setup:
// OPENROUTER_API_KEYS="key1,key2"
// OPENROUTER_MODEL="openrouter/free" (optional override)

export interface KeyTelemetry {
  index: number;
  keyId: string;
  maskedKey: string;
  bucket: "Queue-1 (Primary)" | "Queue-2 (Fallback)";
  status: "idle" | "active" | "cooling_down" | "exhausted";
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  estimatedTokens: number;
  lastUsedAt?: string;
  cooldownUntil?: number;
}

export class OpenRouterService {
  // Key telemetry map
  private static telemetry: Map<number, KeyTelemetry> = new Map();

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
   * Split keys into Double Queue Buckets:
   * Queue 1 (Primary): First half (e.g. keys 1-4)
   * Queue 2 (Fallback / Standby): Second half (e.g. keys 5-8)
   */
  private static getQueues(): { queue1: number[]; queue2: number[] } {
    const keys = this.getAllKeys();
    const half = Math.max(1, Math.ceil(keys.length / 2));
    const queue1: number[] = [];
    const queue2: number[] = [];

    for (let i = 0; i < keys.length; i++) {
      if (i < half) {
        queue1.push(i);
      } else {
        queue2.push(i);
      }
    }
    return { queue1, queue2 };
  }

  // Active queue and index pointers
  private static activeQueue: 1 | 2 = 1;
  private static q1Index = 0;
  private static q2Index = 0;

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

  private static maskKey(key: string): string {
    if (key.length <= 12) return "******";
    return `${key.slice(0, 8)}...${key.slice(-6)}`;
  }

  /**
   * Initializes or updates telemetry records for all known keys.
   */
  private static initTelemetry() {
    const keys = this.getAllKeys();
    const { queue1 } = this.getQueues();
    const now = Date.now();

    keys.forEach((key, index) => {
      if (!this.telemetry.has(index)) {
        this.telemetry.set(index, {
          index,
          keyId: `OPENROUTER_API_KEY_${index + 1}`,
          maskedKey: this.maskKey(key),
          bucket: queue1.includes(index) ? "Queue-1 (Primary)" : "Queue-2 (Fallback)",
          status: "idle",
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          estimatedTokens: 0,
        });
      } else {
        const item = this.telemetry.get(index)!;
        // Check if cooldown expired
        if (item.status === "cooling_down" && item.cooldownUntil && item.cooldownUntil <= now) {
          item.status = "idle";
          item.cooldownUntil = undefined;
        }
      }
    });
  }

  /**
   * Returns current telemetry and queue status for Admin Dashboard.
   */
  public static getTelemetryData() {
    this.initTelemetry();
    const { queue1, queue2 } = this.getQueues();
    const items = Array.from(this.telemetry.values());

    return {
      activeQueue: this.activeQueue,
      totalKeys: items.length,
      queue1: {
        name: "Queue-1 (Primary Active)",
        keysCount: queue1.length,
        activeKeyIndex: queue1[this.q1Index % Math.max(1, queue1.length)],
        status: this.activeQueue === 1 ? "In Service" : "Depleted / Cooling Down",
        keys: items.filter((k) => queue1.includes(k.index)),
      },
      queue2: {
        name: "Queue-2 (Secondary Fallback)",
        keysCount: queue2.length,
        activeKeyIndex: queue2[this.q2Index % Math.max(1, queue2.length)],
        status: this.activeQueue === 2 ? "In Service (Failover Active)" : "Standby (Armed)",
        keys: items.filter((k) => queue2.includes(k.index)),
      },
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

    this.initTelemetry();
    const { queue1, queue2 } = this.getQueues();
    const model = image ? this.getVisionModel() : this.getModel();
    
    // Attempt sequence across Queue 1 first; if all Queue 1 fail/exhausted, fall back to Queue 2
    let attempts = 0;
    const maxAttempts = keys.length;

    while (attempts < maxAttempts) {
      // Determine which queue to pull from
      let keyIndex: number;

      if (this.activeQueue === 1) {
        // Find next eligible key in Queue 1
        const availableInQ1 = queue1.filter((idx) => {
          const t = this.telemetry.get(idx);
          return t?.status !== "cooling_down" && t?.status !== "exhausted";
        });

        if (availableInQ1.length > 0) {
          keyIndex = availableInQ1[this.q1Index % availableInQ1.length];
        } else {
          // Queue 1 completely empty/exhausted! Switch to Queue 2
          console.warn("[OpenRouterService] Queue-1 exhausted or cooling down. Falling back to Queue-2 (Secondary Bucket).");
          this.activeQueue = 2;
          keyIndex = queue2[this.q2Index % Math.max(1, queue2.length)];
        }
      } else {
        // In Queue 2: First check if any Queue 1 key has recovered from cooldown
        const recoveredQ1 = queue1.find((idx) => {
          const t = this.telemetry.get(idx);
          return t?.status === "idle";
        });

        if (recoveredQ1 !== undefined) {
          console.log("[OpenRouterService] Queue-1 has recovered! Returning primary traffic to Queue-1.");
          this.activeQueue = 1;
          keyIndex = recoveredQ1;
        } else {
          keyIndex = queue2[this.q2Index % Math.max(1, queue2.length)];
        }
      }

      const activeKey = keys[keyIndex];
      const maskedKey = this.maskKey(activeKey);
      const tel = this.telemetry.get(keyIndex)!;
      tel.status = "active";
      tel.totalRequests++;
      tel.lastUsedAt = new Date().toISOString();

      const url = "https://openrouter.ai/api/v1/chat/completions";
      console.log(`[OpenRouterService] [${tel.bucket}] Using key #${keyIndex + 1} (${maskedKey}). Attempt ${attempts + 1}/${maxAttempts}`);

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

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        // Approximate token calculation (~4 chars per token)
        const promptTokens = Math.ceil(prompt.length / 4);

        if (response.status === 429) {
          console.warn(`[OpenRouterService] Key #${keyIndex + 1} (${maskedKey}) rate limited (429). Setting 3-minute cooldown.`);
          tel.status = "cooling_down";
          tel.failedRequests++;
          tel.cooldownUntil = Date.now() + 3 * 60 * 1000;
          this.advanceQueue(this.activeQueue);
          attempts++;
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[OpenRouterService] Key #${keyIndex + 1} (${maskedKey}) failed with status ${response.status}: ${errText}`);
          tel.status = response.status === 401 || response.status === 402 ? "exhausted" : "cooling_down";
          tel.failedRequests++;
          this.advanceQueue(this.activeQueue);
          attempts++;
          continue;
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;

        if (!text || text.trim().length === 0) {
          tel.failedRequests++;
          this.advanceQueue(this.activeQueue);
          attempts++;
          continue;
        }

        // Token usage recorded
        const completionTokens = Math.ceil(text.length / 4);
        const actualUsage = data?.usage?.total_tokens || (promptTokens + completionTokens);
        tel.estimatedTokens += actualUsage;
        tel.successfulRequests++;
        tel.status = "idle";

        if (jsonMode) {
          try {
            const parsed = JSON.parse(text.trim());
            return parsed;
          } catch (parseErr: any) {
            tel.failedRequests++;
            this.advanceQueue(this.activeQueue);
            attempts++;
            continue;
          }
        }

        return text;
      } catch (err: any) {
        console.error(`[OpenRouterService] Connection error with key #${keyIndex + 1}:`, err.message);
        tel.status = "cooling_down";
        tel.failedRequests++;
        this.advanceQueue(this.activeQueue);
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(`All available OpenRouter keys across Queue-1 and Queue-2 failed. Last error: ${err.message}`);
        }
      }
    }

    throw new Error("OpenRouter request failed across all queues and buckets.");
  }

  private static advanceQueue(queueNum: 1 | 2) {
    if (queueNum === 1) {
      this.q1Index++;
    } else {
      this.q2Index++;
    }
  }
}

