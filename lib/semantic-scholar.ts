import type { Paper } from "@/lib/types";

const SEMANTIC_SCHOLAR_SEARCH_URL =
  "https://api.semanticscholar.org/graph/v1/paper/search";

const SEARCH_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "year",
  "authors",
  "url",
  "externalIds",
  "citationCount",
  "influentialCitationCount",
  "publicationTypes",
  "fieldsOfStudy",
  "venue",
  "isOpenAccess",
  "openAccessPdf",
].join(",");

const MAX_EVIDENCE_PAPERS = 8;
const SEARCH_RESULT_LIMIT = 12;
const MIN_ABSTRACT_LENGTH = 80;

type SemanticScholarAuthor = {
  authorId?: string | null;
  name?: string | null;
};

type SemanticScholarPaper = {
  paperId?: string | null;
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  authors?: SemanticScholarAuthor[] | null;
  url?: string | null;
  externalIds?: Record<string, string | null> | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  publicationTypes?: string[] | null;
  fieldsOfStudy?: string[] | null;
  venue?: string | null;
  isOpenAccess?: boolean | null;
  openAccessPdf?: {
    url?: string | null;
    status?: string | null;
  } | null;
};

type SemanticScholarSearchResponse = {
  total?: number;
  offset?: number;
  next?: number;
  data?: SemanticScholarPaper[];
};

export class AcademicSearchError extends Error {
  code: "SEARCH_RATE_LIMIT" | "SEARCH_UNAVAILABLE";

  constructor(
    code: "SEARCH_RATE_LIMIT" | "SEARCH_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "AcademicSearchError";
    this.code = code;
  }
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mapPaper(raw: SemanticScholarPaper, sourceId: string): Paper | null {
  const title = cleanText(raw.title);
  const abstract = cleanText(raw.abstract);
  const paperId = cleanText(raw.paperId);

  if (!paperId || !title || abstract.length < MIN_ABSTRACT_LENGTH) {
    return null;
  }

  const doi = cleanText(raw.externalIds?.DOI) || null;
  const semanticScholarUrl = safeHttpsUrl(raw.url);
  const doiUrl = doi ? `https://doi.org/${encodeURI(doi)}` : null;

  return {
    sourceId,
    paperId,
    title,
    abstract,
    year: typeof raw.year === "number" ? raw.year : null,
    authors: (raw.authors ?? [])
      .map((author) => cleanText(author.name))
      .filter(Boolean)
      .slice(0, 12),
    url: semanticScholarUrl ?? doiUrl,
    doi,
    venue: cleanText(raw.venue) || null,
    citationCount:
      typeof raw.citationCount === "number" ? raw.citationCount : null,
    influentialCitationCount:
      typeof raw.influentialCitationCount === "number"
        ? raw.influentialCitationCount
        : null,
    publicationTypes: (raw.publicationTypes ?? [])
      .map(cleanText)
      .filter(Boolean),
    fieldsOfStudy: (raw.fieldsOfStudy ?? []).map(cleanText).filter(Boolean),
    isOpenAccess:
      typeof raw.isOpenAccess === "boolean" ? raw.isOpenAccess : null,
    openAccessPdfUrl: safeHttpsUrl(raw.openAccessPdf?.url),
  };
}

export async function searchAcademicLiterature(question: string): Promise<{
  papers: Paper[];
  totalResults: number;
}> {
  const url = new URL(SEMANTIC_SCHOLAR_SEARCH_URL);
  url.searchParams.set("query", question);
  url.searchParams.set("limit", String(SEARCH_RESULT_LIMIT));
  url.searchParams.set("fields", SEARCH_FIELDS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "ChatLibris/1.0 (academic literature synthesis)",
  };

  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AcademicSearchError(
        "SEARCH_UNAVAILABLE",
        "The academic search timed out. Please try again.",
      );
    }

    throw new AcademicSearchError(
      "SEARCH_UNAVAILABLE",
      "The academic search service could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new AcademicSearchError(
      "SEARCH_RATE_LIMIT",
      "The academic search service is receiving too many requests. Please try again shortly.",
    );
  }

  if (!response.ok) {
    throw new AcademicSearchError(
      "SEARCH_UNAVAILABLE",
      "The academic search service returned an error.",
    );
  }

  const payload = (await response.json()) as SemanticScholarSearchResponse;
  const seenTitles = new Set<string>();
  const seenDois = new Set<string>();
  const papers: Paper[] = [];

  for (const rawPaper of payload.data ?? []) {
    const candidate = mapPaper(rawPaper, `P${papers.length + 1}`);
    if (!candidate) continue;

    const titleKey = normalizeTitle(candidate.title);
    const doiKey = candidate.doi?.toLowerCase() ?? null;

    if (seenTitles.has(titleKey) || (doiKey && seenDois.has(doiKey))) {
      continue;
    }

    seenTitles.add(titleKey);
    if (doiKey) seenDois.add(doiKey);
    papers.push(candidate);

    if (papers.length >= MAX_EVIDENCE_PAPERS) break;
  }

  // Reassign IDs after filtering so the sequence is always contiguous.
  const normalizedPapers = papers.map((paper, index) => ({
    ...paper,
    sourceId: `P${index + 1}`,
  }));

  return {
    papers: normalizedPapers,
    totalResults:
      typeof payload.total === "number" ? payload.total : normalizedPapers.length,
  };
}
