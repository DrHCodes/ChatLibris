import { z } from "zod";

export const QuestionRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(8, "Please ask a complete question.")
    .max(500, "Please keep the question under 500 characters."),
});

export const EvidenceStatusSchema = z.enum([
  "supported",
  "mixed",
  "unknown",
]);

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);

export const ModelClaimSchema = z.object({
  statement: z
    .string()
    .describe("One concise factual finding supported by the cited papers."),
  sourceIds: z
    .array(z.string())
    .describe("One or more source IDs such as P1 or P3."),
});

export const ModelSynthesisSchema = z.object({
  status: EvidenceStatusSchema.describe(
    "supported when the evidence directly supports an answer, mixed when relevant studies materially disagree, or unknown when the retrieved evidence is insufficient.",
  ),
  confidence: ConfidenceSchema.describe(
    "Confidence in the synthesis of the supplied evidence, not certainty that the claim is universally true.",
  ),
  answer: z
    .string()
    .describe(
      "A direct, plain-language answer bounded exclusively by the supplied evidence.",
    ),
  rationale: z
    .string()
    .describe(
      "A concise explanation of why the evidence earned this status, including disagreement or insufficiency when relevant.",
    ),
  directlyRelevantSourceIds: z
    .array(z.string())
    .describe("The source IDs that directly address the user's question."),
  claims: z
    .array(ModelClaimSchema)
    .describe("Up to five key evidence-backed findings."),
  limitations: z
    .array(z.string())
    .describe("Up to five important limitations or caveats."),
});

export type ModelSynthesis = z.infer<typeof ModelSynthesisSchema>;
