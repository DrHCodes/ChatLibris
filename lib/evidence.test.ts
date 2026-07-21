import { describe, expect, it } from "vitest";
import { createUnknownResult, finalizeSynthesis } from "@/lib/evidence";
import type { ModelSynthesis } from "@/lib/schemas";
import type { Paper } from "@/lib/types";

const paper = (sourceId: string): Paper => ({
  sourceId,
  paperId: `paper-${sourceId}`,
  title: `Paper ${sourceId}`,
  abstract: "A sufficiently long abstract that directly describes the study and its findings for testing purposes.",
  year: 2025,
  authors: ["Ada Scholar"],
  url: "https://example.com/paper",
  doi: null,
  venue: "Journal of Tests",
  citationCount: 4,
  influentialCitationCount: 1,
  publicationTypes: ["JournalArticle"],
  fieldsOfStudy: ["Medicine"],
  isOpenAccess: true,
  openAccessPdfUrl: null,
});

describe("evidence gate", () => {
  it("creates a deterministic unknown result", () => {
    const result = createUnknownResult(0);
    expect(result.status).toBe("unknown");
    expect(result.confidence).toBe("low");
    expect(result.claims).toEqual([]);
  });

  it("abstains when a supported answer has no valid citations", () => {
    const synthesis: ModelSynthesis = {
      status: "supported",
      confidence: "high",
      answer: "A claim.",
      rationale: "A rationale.",
      directlyRelevantSourceIds: ["P99"],
      claims: [{ statement: "A finding.", sourceIds: ["P99"] }],
      limitations: [],
    };

    const result = finalizeSynthesis(synthesis, [paper("P1")]);
    expect(result.status).toBe("unknown");
  });

  it("caps confidence at low when only one direct source is available", () => {
    const synthesis: ModelSynthesis = {
      status: "supported",
      confidence: "high",
      answer: "The supplied study supports a provisional answer.",
      rationale: "One directly relevant paper was supplied.",
      directlyRelevantSourceIds: ["P1"],
      claims: [{ statement: "A finding.", sourceIds: ["P1"] }],
      limitations: ["Only one study was retrieved."],
    };

    const result = finalizeSynthesis(synthesis, [paper("P1")]);
    expect(result.status).toBe("supported");
    expect(result.confidence).toBe("low");
  });
});
