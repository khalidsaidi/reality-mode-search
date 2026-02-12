# Reality Mode Search

Next.js app that queries Brave Search and shows results in upstream order (with stable URL canonicalization + dedup only).

## Reality Mode Rules (No-Drift)

- No re-ranking. No boosting/penalizing. No language/country/domain caps.
- The only allowed modification is:
  - URL canonicalization (remove fragments + common tracking params)
  - Stable dedup by canonical URL (keep first occurrence)

## Upstream Parameters (Brave)

Brave Web Search has implicit defaults that can look US/English-biased if you don't set them:

- Default `country` is `US`, so we force `country=ALL` when no country hint is selected.
- Default `search_lang` is `en`.
  - Default behavior (`lang=auto`) sends an explicit `search_lang`, inferring it from the query language (franc ISO-639-3) when possible, otherwise falling back to `en`.
  - Optional: `lang=all` omits the hint (provider default), and `lang=<code>` forces a Brave-supported language code.
- We do not send any `x-loc-*` geo headers.

## Caching / Fairness Model (Sustainability)

Two key modes:

- **Server key** (`BRAVE_API_KEY`): responses are CDN-cacheable via `CDN-Cache-Control` with long TTL.
  - Goal: reduce upstream calls so the public demo stays free.
- **BYO key** (client sends `x-user-brave-key`, gated by `ENABLE_BYO_KEY=true`): responses are `private, no-store`.
  - Goal: prevent user-supplied keys from subsidizing other users via shared CDN cache.

There is also a soft **daily miss budget** guard (in-memory per instance). Combined with CDN caching this is sufficient for an MVP.

## Dev

```bash
npm install
npm run dev
```

## Env Vars

Set in Vercel (or `.env.local` locally):

- `BRAVE_API_KEY` (optional but recommended for public demo)
- `CACHE_TTL_SECONDS=604800`
- `SWR_SECONDS=0`
- `STALE_IF_ERROR_SECONDS=604800`
- `DAILY_MISS_BUDGET=1500`
- `ENABLE_BYO_KEY=true`

## Verify CDN Caching (Server Key Path)

1. Call `/api/search?q=hello` twice (without BYO key header).
2. The second response should be served from cache (look for `x-vercel-cache=HIT` on Vercel).

BYO key requests should never be cached (they are `private, no-store`).

## Fairness Inspection Tools

- **Global Compare**: runs the same query across a small fixed set of country hints (`ALL`, `FR`, `IN`, `BR`, `JP`, `US`) and shows each bucket independently.
- **All Countries Sweep (249)**: runs across all ISO countries in the UI.
  - Unsupported country hints are marked without probing upstream.
  - Provider-supported countries are probed sequentially with delay (to respect Brave free-plan rate limits).
  - Requires BYO key (`x-user-brave-key`) to avoid exhausting shared server-key budget.

## Connect GitHub to Vercel

1. In Vercel Dashboard: Add New Project -> Import Git Repository -> select `khalidsaidi/reality-mode-search`.
2. Set Production Branch to `main` (default).
3. Deploy. Future `git push` to `main` should trigger production deployments automatically.

CLI alternative (requires the GitHub integration connected in Vercel):

```bash
vercel link --yes --project reality-mode-search
vercel git connect https://github.com/khalidsaidi/reality-mode-search.git
```
