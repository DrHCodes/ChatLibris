import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createUnknownResult, finalizeSynthesis } from "@/lib/evidence";
import { buildEvidencePacket, CHATLIBRIS_SYSTEM_PROMPT } from "@/lib/prompt";
import { ModelSynthesisSchema, QuestionRequestSchema } from "@/lib/schemas";
import {
  AcademicSearchError,
  searchAcademicLiterature,
} from "@/lib/semantic-scholar";
import type { AnswerResponse, ApiErrorResponse, Paper } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function publicPaper(paper: Paper): Omit<Paper, "abstract"> {
  const { abstract, ...publicFields } = paper;
  void abstract;
  return publicFields;
}

function errorResponse(
  requestId: string,
  code: ApiErrorResponse["error"]["code"],
  message: string,
  status: number,
) {
  return NextResponse.json<ApiErrorResponse>(
    { error: { code, message }, requestId },
    {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}

async function synthesize(
  openai: OpenAI,
  model: string,
  question: string,
  papers: Paper[],
) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `${CHATLIBRIS_SYSTEM_PROMPT}\n\nReturn ONLY valid JSON matching this exact shape:\n{\n  \"status\": \"supported\" | \"mixed\" | \"unknown\",\n  \"confidence\": \"low\" | \"medium\" | \"high\",\n  \"answer\": string,\n  \"rationale\": string,\n  \"directlyRelevantSourceIds\": string[],\n  \"claims\": [{ \"statement\": string, \"sourceIds\": string[] }],\n  \"limitations\": string[]\n}`,
      },
      {
        role: "user",
        content: buildEvidencePacket(question, papers),
      },
    ],
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("The model returned no synthesis text.");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The model returned invalid JSON.");
  }

  const parsed = ModelSynthesisSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`The model response did not match the schema: ${parsed.error.message}`);
  }

  return parsed.data;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "INVALID_REQUEST", "The request body must be valid JSON.", 400);
  }

  const parsedRequest = QuestionRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return errorResponse(
      requestId,
      "INVALID_REQUEST",
      parsedRequest.error.issues[0]?.message ?? "Please enter a valid question.",
      400,
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return errorResponse(requestId, "CONFIGURATION_ERROR", "ChatLibris is missing its OpenAI API key.", 500);
  }

  const { question } = parsedRequest.data;

  try {
    const { papers, totalResults, provider } = await searchAcademicLiterature(question);

    if (papers.length === 0) {
      const payload: AnswerResponse = {
        question,
        result: createUnknownResult(
          0,
          "ChatLibris did not retrieve any academic papers with usable abstracts that could answer this question.",
          "No usable evidence entered the synthesis step, so ChatLibris abstained without calling the language model.",
        ),
        papers: [],
        search: { provider, totalResults, usablePapers: 0 },
        requestId,
      };
      return NextResponse.json(payload, {
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const primaryModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

    let synthesis;
    try {
      synthesis = await synthesize(openai, primaryModel, question, papers);
    } catch (primaryError) {
      console.error(`[${requestId}] Primary synthesis failed`, primaryError);
      if (primaryModel === "gpt-4.1-mini") throw primaryError;
      synthesis = await synthesize(openai, "gpt-4.1-mini", question, papers);
    }

    const result = finalizeSynthesis(synthesis, papers);
    const payload: AnswerResponse = {
      question,
      result,
      papers: papers.map(publicPaper),
      search: { provider, totalResults, usablePapers: papers.length },
      requestId,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    console.error(`[${requestId}] ChatLibris request failed`, error);

    if (error instanceof AcademicSearchError) {
      return errorResponse(requestId, error.code, error.message, 503);
    }

    if (error instanceof OpenAI.APIError) {
      return errorResponse(
        requestId,
        "SYNTHESIS_UNAVAILABLE",
        `OpenAI could not complete the synthesis (${error.status ?? "unknown status"}). Check the Vercel function log for request ${requestId}.`,
        502,
      );
    }

    return errorResponse(
      requestId,
      "SYNTHESIS_UNAVAILABLE",
      "The evidence was retrieved, but the synthesis could not be completed.",
      502,
    );
  }
}
