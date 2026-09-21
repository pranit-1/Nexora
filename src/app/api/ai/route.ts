import { NextResponse } from "next/server";
import { AIRouterService } from "@/lib/aiProviders";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, data } = body;

    if (!action) {
      return NextResponse.json({ error: "Missing action parameter" }, { status: 400 });
    }

    let prompt = "";
    let jsonMode = false;

    switch (action) {
      case "analyzeResume": {
        const { resumeText } = data;
        prompt = `
          You are a professional ATS resume scanner and Career Coach.
          Analyze the following resume text content:
          """
          ${resumeText}
          """

          Generate an analysis in JSON format containing:
          - atsScore (number from 0 to 100)
          - strengths (array of strings)
          - weaknesses (array of strings)
          - missingSkills (array of strings)
          - formattingFeedback (string)
          - improvementSuggestions (array of strings)

          Ensure the output is valid JSON and matches this schema. Do not output markdown backticks or extra text, just raw JSON.
        `;
        jsonMode = true;
        break;
      }

      case "chatbot": {
        const { message, history, profileContext } = data;
        prompt = `
          You are NEXORA's AI Career Advisor, an intelligent career mentor for university students and researchers worldwide.
          Maintain an encouraging, gender-neutral, professional, and pragmatic tone. Address the student neutrally.
          You answer career-related questions, STEM & academic queries, scholarship guidance, fellowship applications, resume tips, and learning roadmaps.
          If the question is completely unrelated to education, skills, or career guidance, politely refuse and steer back to career growth.
          
          User Profile Information:
          ${JSON.stringify(profileContext)}

          Conversation history:
          ${JSON.stringify(history)}

          User Question: "${message}"

          Provide a sharp, encouraging, and structured response. Keep it concise (1-3 paragraphs) with bullet points where helpful.
        `;
        break;
      }

      case "interview": {
        const { jobTitle, answers } = data;
        prompt = `
          You are an AI Technical Interview Coach.
          The candidate is practicing for a "${jobTitle}" position.
          Here are the questions and their submitted answers:
          ${JSON.stringify(answers)}

          Analyze the performance and generate a JSON object with:
          - technicalFeedback: string (detailed feedback on technical accuracy)
          - communicationFeedback: string (feedback on structure, tone, clarity)
          - confidenceScore: number (0 to 100 rating confidence based on response length, structure, tone)
          - improvementSuggestions: array of strings
          - followUpQuestions: array of strings (2-3 tailored follow-up questions)

          Ensure the output is valid JSON matching this schema. Do not output markdown backticks or extra text.
        `;
        jsonMode = true;
        break;
      }

      case "trackConfidence": {
        const { scores } = data;
        prompt = `
          You are an AI Confidence and Performance Coach.
          Analyze these recent performance metrics:
          ${JSON.stringify(scores)}

          Provide a concise progress summary (2-3 sentences) explaining their progress trends, highlighting where they improved (e.g. resume, interviews, opportunities checked) and giving a motivational sign-off.
        `;
        break;
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const aiResponse = await AIRouterService.requestAI(prompt, jsonMode);
    return NextResponse.json({ success: true, result: aiResponse });

  } catch (error: any) {
    console.error("AI API error:", error);
    return NextResponse.json({ error: error.message || "Failed to contact AI service" }, { status: 500 });
  }
}
