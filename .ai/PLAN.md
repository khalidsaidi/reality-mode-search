# Plan

Goal: Build "Reality Mode Search" as a Vercel-only Next.js app (no DB), using open data (Common Crawl URL index) with strict no-rerank rules and 249-country targeting.

Phases:
1. Repo scaffolding: Next.js (app router) + TS + Tailwind + shadcn-like UI components.
2. Core libs: normalization, URL canonicalization + dedup, TLD/country inference, language detection, reality panel aggregation.
3. Open data provider: Common Crawl index client with safe parsing and timeouts.
4. API: `/api/search` + `/api/compare-country` with rate limiting, daily miss budget guard, and strict caching headers.
5. UI: search form (country-required in open-data mode), results list, reality panel, 249-country sweep.
6. Tests + CI: Vitest, minimal unit tests, GitHub Actions.
7. Docs: README with "Reality Mode" rules and caching model.
