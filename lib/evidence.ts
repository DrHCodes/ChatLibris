import type { ModelSynthesis } from "@/lib/schemas";
import type { ChatLibrisResult, EvidenceClaim, Paper } from "@/lib/types";

const UNKNOWN_ANSWER =
  "The retrieved academic evidence was not sufficient to answer this question.";

function uniqueCleanStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();

    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);

    if (output.length >= limit) break;
  }

  return output;
}

function validateSourceIds(ids: string[], allowed: Set<string>): string[] {
  return [...new Set(ids.filter((id) => allowed.has(id)))];
}

export function createUnknownResult(
  papersReviewed: number,
  answer = UNKNOWN_ANSWER,
  rationale =
    "ChatLibris did not retrieve enough directly relevant academic evidence to establish an answer.",
): ChatLibrisResult {
  return {
    status: "unknown",
    confidence: "low",
    answer,
    rationale,
    directlyRelevantSourceIds: [],
    claims: [],
    limitations: [
      "This result describes the literature retrieved from Semantic Scholar, not every paper that may exist.",
      "An unknown result is not evidence that the proposition is false.",
    ],
    papersReviewed,
    generatedAt: new Date().toISOString(),
  };
}

export function finalizeSynthesis(
  synthesis: ModelSynthesis,
  papers: Paper[],
): ChatLibrisResult {
  const allowedIds = new Set(papers.map((paper) => paper.sourceId));
  const directlyRelevantSourceIds = validateSourceIds(
    synthesis.directlyRelevantSourceIds,
    allowedIds,
  );

  const directIds = new Set(directlyRelevantSourceIds);

  const claims: EvidenceClaim[] = synthesis.claims
    .map((claim) => ({
      statement: claim.statement.replace(/\s+/g, " ").trim(),
      sourceIds: validateSourceIds(claim.sourceIds, allowedIds).filter((id) =>
        directIds.has(id),
      ),
    }))
    .filter((claim) => claim.statement && claim.sourceIds.length > 0)
    .slice(0, 5);

  const answer = synthesis.answer.replace(/\s+/g, " ").trim();
  const rationale = synthesis.rationale.replace(/\s+/g, " ").trim();
  const limitations = uniqueCleanStrings(synthesis.limitations, 5);

  const hasCitedAnswer =
    directlyRelevantSourceIds.length > 0 && claims.length > 0;

  if (synthesis.status !== "unknown" && !hasCitedAnswer) {
    return createUnknownResult(
      papers.length,
      "The retrieved evidence was insufficient to produce a properly cited answer.",
      "The synthesis did not contain valid direct evidence and claim-level citations, so ChatLibris abstained.",
    );
  }

  if (synthesis.status === "unknown") {
    return {
      ...createUnknownResult(
        papers.length,
        answer || UNKNOWN_ANSWER,
        rationale ||
          "The retrieved papers did not directly establish an answer.",
      ),
      directlyRelevantSourceIds,
      limitations:
        limitations.length > 0
          ? limitations
          : createUnknownResult(papers.length).limitations,
    };
  }

  let confidence = synthesis.confidence;

  // One directly relevant paper can support a provisional answer, but never
  // more than low confidence in this compact retrieval setting.
  if (directlyRelevantSourceIds.length === 1) {
    confidence = "low";
  }

  if (synthesis.status === "mixed" && confidence === "high") {
    confidence = "medium";
  }

  return {
    status: synthesis.status,
    confidence,
    answer: answer || UNKNOWN_ANSWER,
    rationale:
      rationale ||
      "The verdict reflects the directly relevant papers in the retrieved evidence packet.",
    directlyRelevantSourceIds,
    claims,
    limitations,
    papersReviewed: papers.length,
    generatedAt: new Date().toISOString(),
  };
}
