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
  provider: "Semantic Scholar" | "Europe PMC";
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
    return searchEuropePmc(question);
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
    provider: "Semantic Scholar",
  };
}

type EuropePmcResult = {
  id?: string;
  source?: string;
  title?: string;
  abstractText?: string;
  pubYear?: string;
  authorString?: string;
  journalTitle?: string;
  doi?: string;
  citedByCount?: number;
  pubTypeList?: { pubType?: string[] };
  isOpenAccess?: string;
  fullTextUrlList?: { fullTextUrl?: Array<{ url?: string; availability?: string }> };
};

type EuropePmcResponse = {
  hitCount?: number;
  resultList?: { result?: EuropePmcResult[] };
};

async function searchEuropePmc(question: string): Promise<{
  papers: Paper[];
  totalResults: number;
  provider: "Europe PMC";
}> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", question);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(SEARCH_RESULT_LIMIT));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ChatLibris/1.0 (academic literature synthesis)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new AcademicSearchError(
      "SEARCH_UNAVAILABLE",
      "Both academic search providers are temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AcademicSearchError(
      response.status === 429 ? "SEARCH_RATE_LIMIT" : "SEARCH_UNAVAILABLE",
      "Both academic search providers are temporarily unavailable.",
    );
  }

  const payload = (await response.json()) as EuropePmcResponse;
  const seenTitles = new Set<string>();
  const seenDois = new Set<string>();
  const papers: Paper[] = [];

  for (const raw of payload.resultList?.result ?? []) {
    const title = cleanText(raw.title);
    const abstract = cleanText(raw.abstractText);
    const id = cleanText(raw.id);
    if (!id || !title || abstract.length < MIN_ABSTRACT_LENGTH) continue;

    const doi = cleanText(raw.doi) || null;
    const titleKey = normalizeTitle(title);
    const doiKey = doi?.toLowerCase() ?? null;
    if (seenTitles.has(titleKey) || (doiKey && seenDois.has(doiKey))) continue;

    seenTitles.add(titleKey);
    if (doiKey) seenDois.add(doiKey);

    const fullText = raw.fullTextUrlList?.fullTextUrl
      ?.map((item) => safeHttpsUrl(item.url))
      .find(Boolean) ?? null;

    papers.push({
      sourceId: `P${papers.length + 1}`,
      paperId: `${cleanText(raw.source) || "EPMC"}:${id}`,
      title,
      abstract,
      year: raw.pubYear && /^\d{4}$/.test(raw.pubYear) ? Number(raw.pubYear) : null,
      authors: cleanText(raw.authorString)
        .split(/,|;|\band\b/i)
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, 12),
      url: doi ? `https://doi.org/${encodeURI(doi)}` : `https://europepmc.org/article/${encodeURIComponent(cleanText(raw.source) || "MED")}/${encodeURIComponent(id)}`,
      doi,
      venue: cleanText(raw.journalTitle) || null,
      citationCount: typeof raw.citedByCount === "number" ? raw.citedByCount : null,
      influentialCitationCount: null,
      publicationTypes: (raw.pubTypeList?.pubType ?? []).map(cleanText).filter(Boolean),
      fieldsOfStudy: ["Life sciences"],
      isOpenAccess: raw.isOpenAccess === "Y",
      openAccessPdfUrl: fullText,
    });

    if (papers.length >= MAX_EVIDENCE_PAPERS) break;
  }

  return {
    papers,
    totalResults: typeof payload.hitCount === "number" ? payload.hitCount : papers.length,
    provider: "Europe PMC",
  };
}
