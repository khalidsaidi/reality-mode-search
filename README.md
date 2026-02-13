# Reality Mode Search

Next.js app deployed on Vercel that queries **open data** (Common Crawl URL index) and shows results in upstream order (with stable URL canonicalization + dedup only).

## Reality Mode Rules (No-Drift)

- No re-ranking. No boosting/penalizing. No language/country/domain caps.
- The only allowed modification is:
  - URL canonicalization (remove fragments + common tracking params)
  - Stable dedup by canonical URL (keep first occurrence)

## Open Data Provider (Common Crawl)

This project uses the **Common Crawl Index Server (CDX API)**.

Important limitation (current design):

- Results come from **URL-index filtering** (tokens are matched against URLs), not full-text search of page content.

## OWI (Open Web Index) R&D

If you want to go deeper than Common Crawl's public index server (which can be rate-limited/unreliable under load),
an R&D path is to use OWI datasets and run your own indexing/serving layer.

Notes: `docs/OWI_RND.md`

## Country Targeting (All 249 ISO Codes)

Search requests require `country=<ISO 3166-1 alpha-2>`.

Country targeting is done by mapping the ISO code to a ccTLD pattern:

- Default: `XX -> .xx`
- Override: `GB -> .uk`
- Deterministic proxies for ISO entries without a delegated ccTLD:
  - `BQ -> .nl`, `BL -> .fr`, `MF -> .fr`, `UM -> .us`, `EH -> .es`

The resolved target is applied via CDX: `url=.tld&matchType=domain`.

## Caching / Sustainability

- Responses are CDN-cacheable via `CDN-Cache-Control` with long TTL.
- Soft **daily miss budget** guard (in-memory per instance).
- Per-IP rate limiting:
  - `/api/search`: 30 requests/hour
  - `/api/compare-country`: 400 requests/hour (enough for a 249-country sweep)

## Dev

```bash
npm install
npm run dev
```

## Env Vars

Set in Vercel (or `.env.local` locally):

- `COMMONCRAWL_INDEX_BASE_URL=http://index.commoncrawl.org` (default)
- `COMMONCRAWL_INDEX_ID` (optional pin; defaults to latest)
- `CACHE_TTL_SECONDS=604800`
- `SWR_SECONDS=0`
- `STALE_IF_ERROR_SECONDS=604800`
- `DAILY_MISS_BUDGET=1500`

## Verify CDN Caching

1. Call `/api/search?q=hello&country=FR` twice.
2. The second response should be served from cache (look for `x-vercel-cache=HIT` on Vercel).

## Fairness Inspection Tools

- **Global Compare**: runs the same query across a small fixed set of country hints and shows each bucket independently.
- **All Countries Sweep (249)**: runs across all ISO countries in the UI.
  - Probes are sequential with delay to avoid triggering provider rate limits.

## Connect GitHub to Vercel

1. In Vercel Dashboard: Add New Project -> Import Git Repository -> select `khalidsaidi/reality-mode-search`.
2. Set Production Branch to `main` (default).
3. Deploy. Future `git push` to `main` should trigger production deployments automatically.

CLI alternative (requires the GitHub integration connected in Vercel):

```bash
vercel link --yes --project reality-mode-search
vercel git connect https://github.com/khalidsaidi/reality-mode-search.git
```
