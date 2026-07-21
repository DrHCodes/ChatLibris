import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAcademicLiterature } from "@/lib/semantic-scholar";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEMANTIC_SCHOLAR_API_KEY;
});

describe("Semantic Scholar retrieval", () => {
  it("filters unusable papers, removes duplicates, and assigns contiguous IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 42,
          data: [
            {
              paperId: "paper-1",
              title: "A Useful Study",
              abstract:
                "This abstract is intentionally long enough to pass the evidence filter and describe a directly relevant academic study.",
              year: 2025,
              authors: [{ name: "Ada Scholar" }],
              externalIds: { DOI: "10.1000/example" },
              citationCount: 12,
              publicationTypes: ["JournalArticle"],
              fieldsOfStudy: ["Medicine"],
              venue: "Journal of Evidence",
              url: "https://www.semanticscholar.org/paper/paper-1",
            },
            {
              paperId: "paper-duplicate",
              title: "A Useful Study",
              abstract:
                "This duplicate abstract is also long enough, but the normalized title should cause the paper to be removed from the packet.",
              externalIds: { DOI: "10.1000/example" },
            },
            {
              paperId: "paper-no-abstract",
              title: "Metadata Only",
              abstract: null,
            },
            {
              paperId: "paper-2",
              title: "A Second Study",
              abstract:
                "A second sufficiently detailed abstract provides another test record for the normalized evidence packet returned by the provider.",
              year: 2024,
              authors: [{ name: "Grace Researcher" }],
              url: "http://insecure.example.com/paper",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await searchAcademicLiterature(
      "Does the intervention improve the outcome?",
    );

    expect(result.totalResults).toBe(42);
    expect(result.papers).toHaveLength(2);
    expect(result.papers.map((paper) => paper.sourceId)).toEqual(["P1", "P2"]);
    expect(result.papers[0]?.doi).toBe("10.1000/example");
    expect(result.papers[1]?.url).toBeNull();

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.hostname).toBe("api.semanticscholar.org");
    expect(requestUrl.searchParams.get("limit")).toBe("12");
  });

  it("turns a 429 response into a rate-limit error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
    );

    await expect(
      searchAcademicLiterature("A complete academic question?"),
    ).rejects.toMatchObject({
      code: "SEARCH_RATE_LIMIT",
    });
  });
});
