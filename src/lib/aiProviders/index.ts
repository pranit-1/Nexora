import { GroqService } from "./groq";
import { OpenRouterService } from "./openrouter";
import { GeminiRotatorService } from "../gemini";

export class AIRouterService {
  /**
   * Provenance of the most recent request, for honest downstream labelling.
   *
   * This matters because a text-only model asked about a document image will
   * still return a confident-looking answer; it just invented it. Callers that
   * send an image must be able to report "the image was not actually read".
   */
  public static lastRequestUsedVision = false;
  /** Which provider actually served the most recent request. */
  public static lastRequestProvider: string | null = null;

  /**
   * Hard ceiling for a single routing attempt across every provider. Vercel
   * kills the function at its own limit (a 504 with no body); this keeps the
   * whole cascade inside the platform budget and returns a readable error.
   */
  private static get totalBudgetMs(): number {
    const raw = Number(process.env.AI_TOTAL_TIMEOUT_MS);
    return Number.isFinite(raw) && raw >= 5_000 ? raw : 120_000;
  }

  /** Rejects with a labelled error if `promise` has not settled by the deadline. */
  private static withBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`AI request exceeded the ${budgetMs}ms time budget`)),
        budgetMs
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  public static async requestAI(prompt: string, jsonMode: boolean = false): Promise<any> {
    AIRouterService.lastRequestUsedVision = false;
    const budgetMs = this.totalBudgetMs;
    const deadline = Date.now() + budgetMs;
    return this.withBudget(this.runAI(prompt, jsonMode, deadline), budgetMs);
  }

  private static async runAI(prompt: string, jsonMode: boolean, deadline: number): Promise<any> {
    // 1. Try Gemini first if keys exist
    if (process.env.GEMINI_API_KEYS || process.env.NEXT_PUBLIC_GEMINI_API_KEYS) {
      try {
        const geminiResult = await GeminiRotatorService.requestGemini(prompt, jsonMode, deadline);
        AIRouterService.lastRequestProvider = "gemini";
        return geminiResult;
      } catch (geminiErr: any) {
        console.warn(`[AIRouter] Gemini failed, falling back to OpenRouter. Reason: ${geminiErr.message}`);
      }
    }

    // 2. Try OpenRouter
    try {
      const result = await OpenRouterService.request(prompt, jsonMode, deadline);
      AIRouterService.lastRequestProvider = "openrouter";
      return result;
    } catch (openRouterErr: any) {
      console.warn(`[AIRouter] OpenRouter failed, falling back to Groq. Reason: ${openRouterErr.message}`);

      // 3. Try Groq if keys configured
      if (process.env.GROQ_API_KEYS && process.env.GROQ_API_KEYS.trim().length > 0 && !process.env.GROQ_API_KEYS.includes("your_groq_api_key")) {
        try {
          const result = await GroqService.request(prompt, jsonMode, deadline);
          AIRouterService.lastRequestProvider = "groq";
          return result;
        } catch (groqErr: any) {
          AIRouterService.lastRequestProvider = null;
          throw new Error(
            `All AI providers (OpenRouter, Groq) failed. Last error: ${groqErr.message}`
          );
        }
      }

      AIRouterService.lastRequestProvider = null;
      throw new Error(`AI request failed: ${openRouterErr.message}`);
    }
  }

  /**
   * Vision request. Requires a provider that can actually accept an image.
   */
  public static async requestVision(
    prompt: string,
    imageBase64: string,
    mimeType: string = "image/jpeg",
    jsonMode: boolean = false
  ): Promise<any> {
    AIRouterService.lastRequestUsedVision = false;
    const budgetMs = this.totalBudgetMs;
    const deadline = Date.now() + budgetMs;
    return this.withBudget(this.runVision(prompt, imageBase64, mimeType, jsonMode, deadline), budgetMs);
  }

  private static async runVision(
    prompt: string,
    imageBase64: string,
    mimeType: string,
    jsonMode: boolean,
    deadline: number
  ): Promise<any> {
    // 1. Try Gemini Vision first if keys exist
    try {
      const geminiResult = await GeminiRotatorService.requestGeminiVision(prompt, imageBase64, mimeType, jsonMode, deadline);
      AIRouterService.lastRequestProvider = "gemini-vision";
      AIRouterService.lastRequestUsedVision = true;
      return geminiResult;
    } catch (geminiErr: any) {
      console.warn(`[AIRouter] Gemini Vision failed, trying OpenRouter Vision. Reason: ${geminiErr.message}`);
    }

    // 2. Try OpenRouter Vision
    try {
      const result = await OpenRouterService.requestVision(prompt, imageBase64, mimeType, jsonMode, deadline);
      AIRouterService.lastRequestProvider = "openrouter-vision";
      AIRouterService.lastRequestUsedVision = true;
      return result;
    } catch (openRouterErr: any) {
      AIRouterService.lastRequestProvider = null;
      throw new Error(
        `No vision-capable AI provider is available, so the image was not analyzed. ` +
          `Reason: ${openRouterErr.message}`
      );
    }
  }
}

export { GroqService } from "./groq";
export { OpenRouterService } from "./openrouter";
