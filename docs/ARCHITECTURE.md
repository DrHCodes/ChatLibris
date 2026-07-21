# ChatLibris architecture

ChatLibris is deliberately implemented as one Next.js application with one server-side request pipeline.

```text
Browser
  │
  │ POST /api/answer { question }
  ▼
Vercel Node.js Function
  ├─ Validate the request
  ├─ Search Semantic Scholar
  ├─ Remove papers without usable abstracts
  ├─ Deduplicate and assign P1…P8 source IDs
  ├─ Deterministically abstain when nothing usable is retrieved
  ├─ Send only the question and evidence packet to OpenAI
  ├─ Parse a schema-constrained synthesis
  ├─ Reject invented source IDs and unsupported claims
  └─ Return Supported, Mixed, or Unknown
```

## Trust boundary

The synthesis model is not given a web-search tool. Its request contains only:

- The user's question
- Metadata for the selected papers
- The selected abstracts
- Stable source IDs
- The ChatLibris evidence-bounding instruction

This design does not make a language model mathematically incapable of using learned background information. It does make the retrieval boundary explicit, removes general-web content from the evidence packet, requires claim-level source IDs, and converts uncited non-unknown answers into an abstention.

## Abstention layers

1. **No usable abstracts:** the server returns `unknown` without calling OpenAI.
2. **Model judges evidence insufficient:** the schema returns `unknown`.
3. **Invalid direct-source IDs:** the server removes them.
4. **Supported or mixed answer without valid cited claims:** the server converts the response to `unknown`.
5. **Only one direct paper:** confidence is capped at `low`.

## Why abstracts, not PDFs

The MVP uses abstracts to keep latency, licensing complexity, parsing failures, and token usage under control. Full-text retrieval is an intentional post-hackathon extension.

## Main files

- `app/api/answer/route.ts` — request orchestration
- `lib/semantic-scholar.ts` — scholarly retrieval and cleanup
- `lib/prompt.ts` — evidence-bounded synthesis instructions
- `lib/schemas.ts` — Zod schemas for requests and model output
- `lib/evidence.ts` — citation validation and abstention rules
- `components/search-experience.tsx` — client experience
