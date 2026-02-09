# Plan

Goal: Build "Reality Mode Search" as a Vercel-only Next.js app (no DB), using Brave Search API with strict caching/fairness rules and a truly-global country hint selector (full ISO list).

Phases:
1. Repo scaffolding: Next.js (app router) + TS + Tailwind + shadcn-like UI components.
2. Core libs: normalization, URL canonicalization + dedup, TLD/country inference, language detection, reality panel aggregation.
3. API: `/api/search` with rate limiting, daily miss budget guard, and strict caching headers.
4. UI: search form (incl. BYO key + country hint), results list, reality panel.
5. Tests + CI: Vitest, minimal unit tests, GitHub Actions.
6. Docs: README with "Reality Mode" rules and caching model.

