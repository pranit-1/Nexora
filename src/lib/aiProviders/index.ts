// AI Router: tries OpenRouter (primary) first, falls back to Groq (backup)
// if OpenRouter keys are exhausted/failing.

import { GroqService } from "./groq";
import { OpenRouterService } from "./openrouter";

export class AIRouterService {
  public static async requestAI(prompt: string, jsonMode: boolean = false): Promise<any> {
    try {
      return await OpenRouterService.request(prompt, jsonMode);
    } catch (openRouterErr: any) {
      console.warn(`[AIRouter] OpenRouter failed, falling back to Groq. Reason: ${openRouterErr.message}`);

      try {
        return await GroqService.request(prompt, jsonMode);
      } catch (groqErr: any) {
        throw new Error(
          `All AI providers (OpenRouter, Groq) failed. Last error: ${groqErr.message}`
        );
      }
    }
  }
}

export { GroqService } from "./groq";
export { OpenRouterService } from "./openrouter";
