import { NextResponse } from "next/server";
import { AIRouterService } from "@/lib/aiProviders";
import { GeminiRotatorService } from "@/lib/gemini";
import { normalizeCategory } from "@/lib/wallet/categories";

const MAX_TEXT_CHARS = 6000;

const SYSTEM_RULES = `
You classify student-uploaded documents for an "Opportunity Wallet".

Valid categories (pick exactly one):
- "Resume": CV / resume / cover letter style document.
- "Certificates": participation, course completion, training, appreciation certificates.
- "Awards": trophies, prizes, winners/prize positions, medals, honours, best-in-show.
- "Projects": project reports, theses, capstone write-ups, research papers.
- "Results": marksheets, transcripts, grade cards, score reports, semester results.
- "ID Documents": Aadhaar, PAN, passport, driving licence, voter ID, any government identity proof.
- "Other": genuinely unrecognisable content.

Judge only from the document content. Ignore the file name, the folder it came
from, and any category the user previously picked. A marksheet that mentions
"date of birth" is still "Results", not "ID Documents". A certificate that
mentions winning a prize is "Certificates" unless the document is purely an
award/record with no certificate framing.
`.trim();

function buildPrompt(text?: string, name?: string): string {
  const body = text
    ? `Document text:\n"""\n${text}\n"""`
    : "No machine readable text. Use the attached image.";

  return [
    SYSTEM_RULES,
    `File name (reference only, must not decide the category): ${name || "unknown"}`,
    body,
    'Respond with JSON only, no prose: { "category": "<one category above>", "confidence": <number 0-1>, "reason": "<max 12 words>" }',
  ].join("\n\n");
}

function parseModelResult(raw: any) {
  const data = typeof raw === "string" ? safeParse(raw) : raw;
  if (!data || typeof data !== "object") return null;
  const category = normalizeCategory(data.category ?? data.label ?? data.type);
  if (!category) return null;
  const confidence =
    typeof data.confidence === "number"
      ? Math.min(1, Math.max(0, data.confidence))
      : typeof data.score === "number"
      ? Math.min(1, Math.max(0, data.score))
      : 0.7;
  const reason = typeof data.reason === "string" ? data.reason.slice(0, 140) : "";
  return { category, confidence, reason };
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function hasGeminiKeys() {
  const keys = process.env.GEMINI_API_KEYS || process.env.NEXT_PUBLIC_GEMINI_API_KEYS || "";
  return keys.split(",").some((k) => k.trim().length > 0);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text: string | undefined = body?.text?.trim();
    const imageDataUrl: string | undefined = body?.imageDataUrl;
    const mimeType: string | undefined = body?.mimeType;
    const name: string | undefined = body?.name;

    if (!text && !imageDataUrl) {
      return NextResponse.json(
        { error: "Nothing to classify: provide document text or an image." },
        { status: 400 }
      );
    }

    const truncatedText = text ? text.slice(0, MAX_TEXT_CHARS) : undefined;
    const prompt = buildPrompt(truncatedText, name);
    const errors: string[] = [];
    let result: ReturnType<typeof parseModelResult> = null;
    let usedVision = false;

    if (imageDataUrl?.startsWith("data:")) {
      const base64 = imageDataUrl.slice(imageDataUrl.indexOf(",") + 1);

      if (hasGeminiKeys()) {
        try {
          result = parseModelResult(
            await GeminiRotatorService.requestGeminiVision(prompt, base64, mimeType || "image/jpeg", true)
          );
          usedVision = true;
        } catch (err: any) {
          errors.push(`gemini: ${err.message}`);
        }
      }

      if (!result) {
        try {
          result = parseModelResult(
            await AIRouterService.requestVision(prompt, base64, mimeType || "image/jpeg", true)
          );
          usedVision = true;
        } catch (err: any) {
          errors.push(`vision: ${err.message}`);
        }
      }
    }

    if (!result) {
      try {
        result = parseModelResult(await AIRouterService.requestAI(prompt, true));
      } catch (err: any) {
        errors.push(`text: ${err.message}`);
      }
    }

    if (!result) {
      return NextResponse.json(
        {
          error: "AI classification is unavailable right now.",
          details: errors.length ? errors : ["Model returned an invalid category."],
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      category: result.category,
      confidence: result.confidence,
      reason: result.reason,
      source: usedVision ? "ai-vision" : "ai-text",
      needsReview: result.confidence < 0.55 || result.category === "Other",
    });
  } catch (error: any) {
    console.error("[wallet/categorize] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to classify document." },
      { status: 500 }
    );
  }
}
