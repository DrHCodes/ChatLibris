"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookMarked,
  BookOpen,
  Check,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FileSearch,
  FlaskConical,
  Info,
  Library,
  LoaderCircle,
  Quote,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/page.module.css";
import type {
  AnswerResponse,
  ApiErrorResponse,
  Confidence,
  EvidenceStatus,
} from "@/lib/types";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: AnswerResponse }
  | { kind: "error"; message: string; requestId?: string };

const EXAMPLE_QUESTIONS = [
  "Does creatine supplementation improve strength in healthy adults?",
  "Does exposure to nature reduce stress?",
  "Does sparkling water improve software debugging accuracy?",
];

const SEARCH_PHASES = [
  {
    label: "Searching the academic index",
    detail: "Looking for relevant papers and usable abstracts.",
    icon: Search,
  },
  {
    label: "Screening the evidence",
    detail: "Removing duplicates and weak retrieval matches.",
    icon: FileSearch,
  },
  {
    label: "Checking the evidence boundary",
    detail: "Testing whether the papers directly answer the question.",
    icon: ShieldCheck,
  },
  {
    label: "Building the cited digest",
    detail: "Connecting every finding to a retrieved source.",
    icon: Sparkles,
  },
];

const STATUS_CONTENT: Record<
  EvidenceStatus,
  {
    label: string;
    eyebrow: string;
    title: string;
    icon: typeof BadgeCheck;
  }
> = {
  supported: {
    label: "Evidence supports an answer",
    eyebrow: "SUPPORTED",
    title: "The literature points to an answer.",
    icon: BadgeCheck,
  },
  mixed: {
    label: "Evidence is mixed",
    eyebrow: "MIXED EVIDENCE",
    title: "The literature does not point in one direction.",
    icon: FlaskConical,
  },
  unknown: {
    label: "Answer unknown",
    eyebrow: "UNKNOWN",
    title: "The retrieved literature cannot establish an answer.",
    icon: BookOpen,
  },
};

function confidenceLabel(confidence: Confidence): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Authors not listed";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

function formatPublicationType(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildCopyText(data: AnswerResponse): string {
  const result = data.result;
  const status = STATUS_CONTENT[result.status].label;
  const claims = result.claims
    .map(
      (claim) =>
        `• ${claim.statement} [${claim.sourceIds.join(", ")}]`,
    )
    .join("\n");
  const limitations = result.limitations
    .map((limitation) => `• ${limitation}`)
    .join("\n");
  const papers = data.papers
    .map(
      (paper) =>
        `[${paper.sourceId}] ${paper.title} — ${formatAuthors(paper.authors)}${paper.year ? ` (${paper.year})` : ""}`,
    )
    .join("\n");

  return [
    "ChatLibris literature digest",
    `Question: ${data.question}`,
    `Verdict: ${status} · ${confidenceLabel(result.confidence)}`,
    "",
    result.answer,
    "",
    `Why this verdict: ${result.rationale}`,
    claims ? `\nKey findings\n${claims}` : "",
    limitations ? `\nLimitations\n${limitations}` : "",
    papers ? `\nSources\n${papers}` : "",
    "",
    "Generated from academic metadata and abstracts retrieved through Semantic Scholar. Unknown means not established by the retrieved evidence, not proven false.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function SearchExperience() {
  const [question, setQuestion] = useState("");
  const [viewState, setViewState] = useState<ViewState>({ kind: "idle" });
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  const isLoading = viewState.kind === "loading";
  const currentPhase = SEARCH_PHASES[phaseIndex] ?? SEARCH_PHASES[0];
  const PhaseIcon = currentPhase.icon;

  useEffect(() => {
    if (!isLoading) return;

    const interval = window.setInterval(() => {
      setPhaseIndex((current) =>
        Math.min(current + 1, SEARCH_PHASES.length - 1),
      );
    }, 1_650);

    return () => window.clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    if (viewState.kind !== "success" && viewState.kind !== "error") return;

    const timeout = window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [viewState]);

  const statusContent = useMemo(() => {
    if (viewState.kind !== "success") return null;
    return STATUS_CONTENT[viewState.data.result.status];
  }, [viewState]);

  async function submitQuestion(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const cleanQuestion = question.trim();

    if (cleanQuestion.length < 8 || isLoading) {
      textareaRef.current?.focus();
      return;
    }

    setCopied(false);
    setPhaseIndex(0);
    setViewState({ kind: "loading" });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 65_000);

    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as AnswerResponse | ApiErrorResponse;

      if (!response.ok || "error" in payload) {
        const message =
          "error" in payload
            ? payload.error.message
            : "ChatLibris could not complete the request.";
        const requestId = "requestId" in payload ? payload.requestId : undefined;
        setViewState({ kind: "error", message, requestId });
        return;
      }

      setViewState({ kind: "success", data: payload });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "The literature search took too long. Please try again."
          : "ChatLibris could not reach the server. Check your connection and try again.";
      setViewState({ kind: "error", message });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submitQuestion();
    }
  }

  function chooseExample(example: string) {
    setQuestion(example);
    setViewState({ kind: "idle" });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function resetSearch() {
    setQuestion("");
    setViewState({ kind: "idle" });
    setCopied(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function copyDigest() {
    if (viewState.kind !== "success") return;

    try {
      await navigator.clipboard.writeText(buildCopyText(viewState.data));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className={styles.pageShell}>
      <div className={styles.ambientOrbOne} aria-hidden="true" />
      <div className={styles.ambientOrbTwo} aria-hidden="true" />

      <header className={styles.siteHeader}>
        <a className={styles.brand} href="#top" aria-label="ChatLibris home">
          <span className={styles.brandMark} aria-hidden="true">
            <Library size={21} strokeWidth={1.9} />
          </span>
          <span className={styles.brandText}>ChatLibris</span>
        </a>

        <div className={styles.headerPill}>
          <ShieldCheck size={15} />
          Academic sources only
        </div>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroEyebrow}>
          <span className={styles.eyebrowDot} />
          Evidence-bounded answers
        </div>

        <h1>
          Ask the literature.
          <span> Get evidence, not vibes.</span>
        </h1>

        <p className={styles.heroCopy}>
          ChatLibris searches an academic index, synthesizes only the retrieved
          papers, and says <strong>unknown</strong> when the evidence cannot
          support an answer.
        </p>

        <form className={styles.searchCard} onSubmit={submitQuestion}>
          <div className={styles.searchCardTopline}>
            <label htmlFor="research-question">What do you want to know?</label>
            <span>No paper, no answer.</span>
          </div>

          <div className={styles.textareaWrap}>
            <BookMarked aria-hidden="true" size={21} />
            <textarea
              ref={textareaRef}
              id="research-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, 500))}
              onKeyDown={handleTextareaKeyDown}
              rows={3}
              maxLength={500}
              disabled={isLoading}
              placeholder="Does creatine supplementation improve strength in healthy adults?"
              aria-describedby="question-help"
            />
          </div>

          <div className={styles.searchActions}>
            <span id="question-help" className={styles.keyboardHint}>
              <kbd>⌘</kbd> <span>+</span> <kbd>Enter</kbd> to search
            </span>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={question.trim().length < 8 || isLoading}
            >
              {isLoading ? (
                <>
                  <LoaderCircle className={styles.spin} size={18} />
                  Reviewing papers
                </>
              ) : (
                <>
                  Search the literature
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </form>

        <div className={styles.examples} aria-label="Example questions">
          <span>Try an example</span>
          <div className={styles.exampleButtons}>
            {EXAMPLE_QUESTIONS.map((example, index) => (
              <button
                type="button"
                key={example}
                onClick={() => chooseExample(example)}
              >
                <span>0{index + 1}</span>
                {example}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className={styles.trustStrip}>
          <div>
            <Search size={18} />
            <span>
              <strong>Academic retrieval</strong>
              No general web search
            </span>
          </div>
          <div>
            <Quote size={18} />
            <span>
              <strong>Claim-level citations</strong>
              Every finding names its papers
            </span>
          </div>
          <div>
            <ShieldCheck size={18} />
            <span>
              <strong>Designed to abstain</strong>
              Insufficient evidence returns unknown
            </span>
          </div>
        </div>
      </section>

      {viewState.kind === "loading" && (
        <section className={styles.loadingSection} aria-live="polite">
          <div className={styles.loadingCard}>
            <div className={styles.loadingIconWrap}>
              <PhaseIcon size={24} />
            </div>
            <div className={styles.loadingText}>
              <span>ChatLibris is working</span>
              <h2>{currentPhase.label}</h2>
              <p>{currentPhase.detail}</p>
            </div>
            <div className={styles.phaseTrack} aria-hidden="true">
              {SEARCH_PHASES.map((phase, index) => (
                <span
                  key={phase.label}
                  className={index <= phaseIndex ? styles.phaseActive : ""}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {viewState.kind === "error" && (
        <section ref={resultRef} className={styles.resultSection} aria-live="polite">
          <div className={styles.errorCard}>
            <span className={styles.errorIcon}>
              <AlertTriangle size={24} />
            </span>
            <div>
              <span className={styles.errorEyebrow}>REQUEST NOT COMPLETED</span>
              <h2>We could not finish this literature search.</h2>
              <p>{viewState.message}</p>
              {viewState.requestId && (
                <small>Request ID: {viewState.requestId}</small>
              )}
            </div>
            <button type="button" onClick={() => void submitQuestion()}>
              <RefreshCw size={16} />
              Try again
            </button>
          </div>
        </section>
      )}

      {viewState.kind === "success" && statusContent && (
        <section ref={resultRef} className={styles.resultSection} aria-live="polite">
          <div
            className={styles.resultHeader}
            data-status={viewState.data.result.status}
          >
            <div className={styles.resultStatusIcon}>
              <statusContent.icon size={25} />
            </div>
            <div className={styles.resultHeading}>
              <div className={styles.resultEyebrowRow}>
                <span className={styles.resultEyebrow}>
                  {statusContent.eyebrow}
                </span>
                <span className={styles.confidenceBadge}>
                  {confidenceLabel(viewState.data.result.confidence)}
                </span>
              </div>
              <h2>{statusContent.title}</h2>
              <p className={styles.resultQuestion}>{viewState.data.question}</p>
            </div>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => void copyDigest()}
            >
              {copied ? <Check size={16} /> : <Clipboard size={16} />}
              {copied ? "Copied" : "Copy digest"}
            </button>
          </div>

          <div className={styles.resultGrid}>
            <article className={styles.answerColumn}>
              <div className={styles.answerCard}>
                <span className={styles.sectionKicker}>Literature answer</span>
                <p className={styles.answerText}>{viewState.data.result.answer}</p>

                <div className={styles.rationaleBox}>
                  <Info size={18} />
                  <div>
                    <strong>Why this verdict</strong>
                    <p>{viewState.data.result.rationale}</p>
                  </div>
                </div>
              </div>

              {viewState.data.result.claims.length > 0 && (
                <div className={styles.contentCard}>
                  <div className={styles.cardTitleRow}>
                    <div>
                      <span className={styles.sectionKicker}>Evidence digest</span>
                      <h3>Key findings</h3>
                    </div>
                    <span>{viewState.data.result.claims.length} findings</span>
                  </div>

                  <ol className={styles.claimList}>
                    {viewState.data.result.claims.map((claim, index) => (
                      <li key={`${claim.statement}-${index}`}>
                        <span className={styles.claimNumber}>{index + 1}</span>
                        <div>
                          <p>{claim.statement}</p>
                          <div className={styles.citationRow}>
                            {claim.sourceIds.map((sourceId) => (
                              <a key={sourceId} href={`#paper-${sourceId}`}>
                                {sourceId}
                              </a>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {viewState.data.result.limitations.length > 0 && (
                <div className={styles.contentCard}>
                  <div className={styles.cardTitleRow}>
                    <div>
                      <span className={styles.sectionKicker}>Read carefully</span>
                      <h3>Limitations</h3>
                    </div>
                  </div>
                  <ul className={styles.limitationsList}>
                    {viewState.data.result.limitations.map((limitation) => (
                      <li key={limitation}>
                        <span />
                        {limitation}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>

            <aside className={styles.evidenceColumn}>
              <div className={styles.metricsGrid}>
                <div>
                  <span>{viewState.data.result.papersReviewed}</span>
                  <p>Papers reviewed</p>
                </div>
                <div>
                  <span>
                    {viewState.data.result.directlyRelevantSourceIds.length}
                  </span>
                  <p>Directly relevant</p>
                </div>
                <div>
                  <span>{viewState.data.search.totalResults.toLocaleString()}</span>
                  <p>Index matches</p>
                </div>
              </div>

              <div className={styles.sourcesCard}>
                <div className={styles.cardTitleRow}>
                  <div>
                    <span className={styles.sectionKicker}>Source trail</span>
                    <h3>
                      {viewState.data.papers.length > 0
                        ? "Retrieved papers"
                        : "No usable papers"}
                    </h3>
                  </div>
                  <BookOpen size={19} />
                </div>

                {viewState.data.papers.length > 0 ? (
                  <div className={styles.paperList}>
                    {viewState.data.papers.map((paper) => {
                      const direct =
                        viewState.data.result.directlyRelevantSourceIds.includes(
                          paper.sourceId,
                        );
                      const sourceUrl = paper.openAccessPdfUrl ?? paper.url;

                      return (
                        <article
                          className={styles.paperCard}
                          id={`paper-${paper.sourceId}`}
                          key={paper.sourceId}
                          data-direct={direct ? "true" : "false"}
                        >
                          <div className={styles.paperTopline}>
                            <span className={styles.paperId}>{paper.sourceId}</span>
                            {direct && (
                              <span className={styles.directBadge}>
                                <Check size={12} />
                                Direct evidence
                              </span>
                            )}
                          </div>

                          <h4>{paper.title}</h4>
                          <p className={styles.paperAuthors}>
                            {formatAuthors(paper.authors)}
                          </p>

                          <div className={styles.paperMeta}>
                            {paper.year && <span>{paper.year}</span>}
                            {paper.venue && <span>{paper.venue}</span>}
                            {paper.publicationTypes[0] && (
                              <span>
                                {formatPublicationType(
                                  paper.publicationTypes[0],
                                )}
                              </span>
                            )}
                          </div>

                          <div className={styles.paperFooter}>
                            <span>
                              {paper.citationCount === null
                                ? "Citations unavailable"
                                : `${paper.citationCount.toLocaleString()} citations`}
                            </span>
                            {sourceUrl && (
                              <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                Open paper
                                <ExternalLink size={13} />
                              </a>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles.noSourcesCopy}>
                    Nothing with a usable abstract entered the synthesis step.
                  </p>
                )}
              </div>

              <div className={styles.scopeNote}>
                <ShieldCheck size={18} />
                <p>
                  <strong>Evidence boundary</strong>
                  The model received only the question and these retrieved paper
                  abstracts. General-web pages were not searched or added to the
                  evidence packet.
                </p>
              </div>
            </aside>
          </div>

          <div className={styles.resultFooterActions}>
            <button type="button" onClick={resetSearch}>
              Ask another question
              <ArrowRight size={16} />
            </button>
            <span>
              Generated {new Date(viewState.data.result.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {" · "}Request {viewState.data.requestId.slice(0, 8)}
            </span>
          </div>
        </section>
      )}

      <section className={styles.protocolSection}>
        <div className={styles.protocolIntro}>
          <span className={styles.sectionKicker}>The ChatLibris protocol</span>
          <h2>A useful answer—or an honest abstention.</h2>
          <p>
            The product is intentionally narrow. It does not browse forums,
            blogs, social posts, or ordinary search results to fill evidence
            gaps.
          </p>
        </div>
        <div className={styles.protocolSteps}>
          <article>
            <span>01</span>
            <Search size={21} />
            <h3>Retrieve</h3>
            <p>Search a scholarly paper index for the user&apos;s exact question.</p>
          </article>
          <article>
            <span>02</span>
            <FileSearch size={21} />
            <h3>Screen</h3>
            <p>Keep a compact set of deduplicated papers with usable abstracts.</p>
          </article>
          <article>
            <span>03</span>
            <Quote size={21} />
            <h3>Synthesize</h3>
            <p>Build a plain-language digest with source IDs on every finding.</p>
          </article>
          <article>
            <span>04</span>
            <ShieldCheck size={21} />
            <h3>Abstain</h3>
            <p>Return unknown when valid direct evidence does not survive checks.</p>
          </article>
        </div>
      </section>

      <footer className={styles.footer}>
        <div>
          <span className={styles.footerBrand}>
            <Library size={16} /> ChatLibris
          </span>
          <p>Ask the literature. Get evidence, not vibes.</p>
        </div>
        <p>
          Academic metadata provided by Semantic Scholar. ChatLibris summarizes
          research and is not medical advice.
        </p>
      </footer>
    </main>
  );
}
