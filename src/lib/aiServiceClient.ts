import { authedFetch } from "@/lib/apiClient";

export interface ResumeAnalysisResult {
  atsScore: number;
  strengths: string[];
  weaknesses: string[];
  missingSkills: string[];
  formattingFeedback: string;
  improvementSuggestions: string[];
}



/**
 * Thrown when the AI backend could not produce a real answer.
 *
 * This class used to swallow every failure and return a hardcoded, plausible
 * looking result — a fixed `atsScore: 65`, a canned chatbot reply, a canned
 * `confidenceScore: 70` — which the UI then rendered as if a model had produced
 * it. Fabricated scores are worse than no scores: a student acted on them.
 * Callers must handle this and show an honest "unavailable" state.
 */
export class AIServiceUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message || "The AI service is unavailable right now.");
    this.name = "AIServiceUnavailableError";
    this.reason = reason;
  }
}

export class AIServiceClient {
  private static async postRequest(action: string, data: unknown): Promise<any> {
    let response: Response;
    try {
      response = await authedFetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data }),
      });
    } catch (e) {
      console.error(`AI Client network error for action ${action}:`, e);
      throw new AIServiceUnavailableError("network", "Could not reach the AI service. Check your connection.");
    }

    if (!response.ok) {
      let message = `The AI service returned ${response.status}.`;
      try {
        const errData = await response.json();
        if (errData && typeof errData.error === "string" && errData.error.length > 0) {
          message = errData.error;
        }
      } catch {
        // non-JSON error body; keep the status-derived message
      }
      if (response.status === 401) {
        throw new AIServiceUnavailableError("unauthenticated", "Please sign in to use AI features.");
      }
      if (response.status === 429) {
        throw new AIServiceUnavailableError("rate_limited", "Too many AI requests. Wait a moment and try again.");
      }
      throw new AIServiceUnavailableError("provider", message);
    }

    const body = await response.json();
    return body?.result;
  }

  public static async analyzeResume(resumeText: string): Promise<ResumeAnalysisResult> {
    const result = await this.postRequest("analyzeResume", { resumeText });
    if (!result || typeof result !== "object" || typeof result.atsScore !== "number") {
      throw new AIServiceUnavailableError("malformed", "The AI returned an unreadable resume analysis.");
    }
    return {
      atsScore: result.atsScore,
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
      missingSkills: Array.isArray(result.missingSkills) ? result.missingSkills : [],
      formattingFeedback: typeof result.formattingFeedback === "string" ? result.formattingFeedback : "",
      improvementSuggestions: Array.isArray(result.improvementSuggestions) ? result.improvementSuggestions : [],
    };
  }

  public static async getChatbotResponse(
    message: string,
    history: { role: "user" | "model"; text: string }[],
    profileContext: unknown
  ): Promise<string> {
    const result = await this.postRequest("chatbot", { message, history, profileContext });
    if (typeof result !== "string" || result.trim().length === 0) {
      throw new AIServiceUnavailableError("malformed", "The AI returned an empty response.");
    }
    return result;
  }



  public static async trackConfidence(scores: unknown): Promise<string> {
    const result = await this.postRequest("trackConfidence", { scores });
    if (typeof result !== "string" || result.trim().length === 0) {
      throw new AIServiceUnavailableError("malformed", "The AI returned an empty progress summary.");
    }
    return result;
  }
}