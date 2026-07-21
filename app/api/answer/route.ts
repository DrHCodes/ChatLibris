import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { createUnknownResult, finalizeSynthesis } from "@/lib/evidence";
import { buildEvidencePacket, CHATLIBRIS_SYSTEM_PROMPT } from "@/lib/prompt";
import {
  ModelSynthesisSchema,
  QuestionRequestSchema,
} from "@/lib/schemas";
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
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      requestId,
      "INVALID_REQUEST",
      "The request body must be valid JSON.",
      400,
    );
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
    return errorResponse(
      requestId,
      "CONFIGURATION_ERROR",
      "ChatLibris is missing its OpenAI API key.",
      500,
    );
  }

  const { question } = parsedRequest.data;

  try {
    const { papers, totalResults } = await searchAcademicLiterature(question);

    if (papers.length === 0) {
      const payload: AnswerResponse = {
        question,
        result: createUnknownResult(
          0,
          "ChatLibris did not retrieve any academic papers with usable abstracts that could answer this question.",
          "No usable evidence entered the synthesis step, so ChatLibris abstained without calling the language model.",
        ),
        papers: [],
        search: {
          provider: "Semantic Scholar",
          totalResults,
          usablePapers: 0,
        },
        requestId,
      };

      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.parse({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      store: false,
      max_output_tokens: 2_000,
      input: [
        {
          role: "system",
          content: CHATLIBRIS_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildEvidencePacket(question, papers),
        },
      ],
      text: {
        format: zodTextFormat(
          ModelSynthesisSchema,
          "chatlibris_literature_synthesis",
        ),
      },
    });

    if (!response.output_parsed) {
      return errorResponse(
        requestId,
        "SYNTHESIS_UNAVAILABLE",
        "The evidence was retrieved, but the synthesis could not be completed.",
        502,
      );
    }

    const result = finalizeSynthesis(response.output_parsed, papers);
    const payload: AnswerResponse = {
      question,
      result,
      papers: papers.map(publicPaper),
      search: {
        provider: "Semantic Scholar",
        totalResults,
        usablePapers: papers.length,
      },
      requestId,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
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
        "The literature was retrieved, but the evidence synthesis service returned an error.",
        502,
      );
    }

    return errorResponse(
      requestId,
      "INTERNAL_ERROR",
      "ChatLibris could not complete this request. Please try again.",
      500,
    );
  }
}
