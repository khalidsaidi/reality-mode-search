# OWI R&D Notes (OpenWebSearch.eu Open Web Index)

This repo can be used in two modes:

- Production demo mode: Common Crawl public index server (see `README.md`).
- R&D mode: Download OWI shards (Parquet/CIFF) and build/serve our own country-aware index.

## What OWI Is (Practical Summary)

- OWI publishes "index shards" via the LEXIS platform.
- Shards are partitioned by **date** and **language**.
- Shards include:
  - **Parquet** files (content + metadata)
  - **CIFF** files (inverted index snapshots meant for IR tooling)

OWI currently does not provide a hosted public query API, so using it in an app means hosting your own retrieval/index layer.

## Goal Alignment: "Search Across All 249 Countries"

To avoid hidden provider geo defaults and to explicitly "hit 249", the clean approach is:

1. Build a country-aware index where each document is assigned to a country bucket via ccTLD best-effort inference.
2. Answer a query by producing:
   - `by_country`: per-country result lists (including empty lists).
   - Optional: a deterministic interleave for a single mixed list (explicitly a display rule, not relevance ranking).

## Recommended R&D Path (Cheapest, No Full-Text Ranking)

Build a **URL-only** inverted index from OWI metadata:

- Tokenize URL (hostname/path) only.
- Keep stable ordering by `(urlkey asc, timestamp desc)` or similar.
- This preserves the "no re-ranking" spirit (there is no relevance model).

This is dramatically cheaper than serving full-text search and is sufficient to validate "249-country fairness" mechanics.

## Next Steps Checklist (Requires OWI Access)

1. Create/confirm OWI/LEXIS credentials (required to list/pull datasets).
2. Pick a small scope for R&D:
   - 1 day or 1 week of shards
   - 1-3 languages to start (then expand)
3. Download shards locally (or into GCS).
4. Run a batch job that produces our country-aware URL index artifacts.
5. Serve query endpoint from Cloud Run (or locally) and point the Next.js app to it.

## Workspace Helpers

Planned (to add as R&D grows):

- `scripts/owi/`:
  - dataset download helpers
  - country slice generation using `src/lib/countryTargeting.ts`
  - build job prototype to create postings/docstores in GCS

