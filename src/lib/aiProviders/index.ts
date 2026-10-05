// AI Router: tries OpenRouter (primary) first, falls back to Groq (backup)
// if OpenRouter keys are exhausted/failing.

import { GroqService } from "./groq";
import { OpenRouterService } from "./openrouter";

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

  public static async requestAI(prompt: string, jsonMode: boolean = false): Promise<any> {
    AIRouterService.lastRequestUsedVision = false;
    try {
      const result = await OpenRouterService.request(prompt, jsonMode);
      AIRouterService.lastRequestProvider = "openrouter";
      return result;
    } catch (openRouterErr: any) {
      console.warn(`[AIRouter] OpenRouter failed, falling back to Groq. Reason: ${openRouterErr.message}`);

      try {
        const result = await GroqService.request(prompt, jsonMode);
        AIRouterService.lastRequestProvider = "groq";
        return result;
      } catch (groqErr: any) {
        AIRouterService.lastRequestProvider = null;
        throw new Error(
          `All AI providers (OpenRouter, Groq) failed. Last error: ${groqErr.message}`
        );
      }
    }
  }

  /**
   * Vision request. Requires a provider that can actually accept an image.
   *
   * The old implementation fell back to `GroqService.request(prompt)` - a
   * text-only completion that silently discards the image and answers from the
   * prompt alone. Callers then stored the result as if the document had been
   * read. There is no honest fallback here: if no vision provider is configured,
   * this throws so the caller can report the failure or fall back to text-only
   * classification explicitly.
   */
  public static async requestVision(
    prompt: string,
    imageBase64: string,
    mimeType: string = "image/jpeg",
    jsonMode: boolean = false
  ): Promise<any> {
    AIRouterService.lastRequestUsedVision = false;
    try {
      const result = await OpenRouterService.requestVision(prompt, imageBase64, mimeType, jsonMode);
      AIRouterService.lastRequestProvider = "openrouter-vision";
      AIRouterService.lastRequestUsedVision = true;
      return result;
    } catch (openRouterErr: any) {
      AIRouterService.lastRequestProvider = null;
      // Deliberately no Groq fallback: GroqService.request is text-only.
      throw new Error(
        `No vision-capable AI provider is available, so the image was not analyzed. ` +
          `Reason: ${openRouterErr.message}`
      );
    }
  }
}

export { GroqService } from "./groq";
export { OpenRouterService } from "./openrouter";
