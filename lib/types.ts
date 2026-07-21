import type { z } from "zod";
import type {
  ConfidenceSchema,
  EvidenceStatusSchema,
} from "@/lib/schemas";

export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;

export type Paper = {
  sourceId: string;
  paperId: string;
  title: string;
  abstract: string;
  year: number | null;
  authors: string[];
  url: string | null;
  doi: string | null;
  venue: string | null;
  citationCount: number | null;
  influentialCitationCount: number | null;
  publicationTypes: string[];
  fieldsOfStudy: string[];
  isOpenAccess: boolean | null;
  openAccessPdfUrl: string | null;
};

export type EvidenceClaim = {
  statement: string;
  sourceIds: string[];
};

export type ChatLibrisResult = {
  status: EvidenceStatus;
  confidence: Confidence;
  answer: string;
  rationale: string;
  directlyRelevantSourceIds: string[];
  claims: EvidenceClaim[];
  limitations: string[];
  papersReviewed: number;
  generatedAt: string;
};

export type AnswerResponse = {
  question: string;
  result: ChatLibrisResult;
  papers: Omit<Paper, "abstract">[];
  search: {
    provider: "Semantic Scholar";
    totalResults: number;
    usablePapers: number;
  };
  requestId: string;
};

export type ApiErrorResponse = {
  error: {
    code:
      | "INVALID_REQUEST"
      | "CONFIGURATION_ERROR"
      | "SEARCH_RATE_LIMIT"
      | "SEARCH_UNAVAILABLE"
      | "SYNTHESIS_UNAVAILABLE"
      | "INTERNAL_ERROR";
    message: string;
  };
  requestId: string;
};
