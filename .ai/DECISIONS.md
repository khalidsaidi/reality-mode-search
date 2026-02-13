# Decisions

## Current (Open Data / Common Crawl)

- Provider: Common Crawl URL index (CDX API). No API keys.
- Country targeting: ISO alpha-2 -> ccTLD target, applied via CDX `url=.tld&matchType=domain`.
  - Override: `GB -> .uk`
  - Deterministic proxies for ISO entries without a delegated ccTLD: `BQ->NL`, `BL->FR`, `MF->FR`, `UM->US`, `EH->ES`
- Caching: Vercel CDN caching via `CDN-Cache-Control` for successful responses (long TTL). Upstream/budget errors use short CDN cache to avoid hammering.
- "Reality Mode" invariant: Upstream order is preserved; only URL canonicalization + stable dedup is applied.

## Superseded (Brave/SerpAPI/SearchApi Prototype)

- Deploy target: Vercel only. No Firestore/GCP/external DB for MVP.
- Caching: Vercel CDN caching via `CDN-Cache-Control` only for server-owned provider key responses; BYO key responses were always `private, no-store`.
- Global baseline: Brave Web Search defaulted `country` to `US` when omitted, so we forced a global mode.
- Language baseline: Brave defaulted `search_lang` to `en` when omitted; we experimented with explicit language hints to avoid hidden defaults.
- Fairness inspection: per-country probe endpoint (`/api/compare-country`) and UI sweep across all 249 ISO countries.

