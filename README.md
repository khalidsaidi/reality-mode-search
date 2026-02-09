# Reality Mode Search

Next.js app that queries Brave Search and shows results in upstream order (with stable URL canonicalization + dedup only).

## Reality Mode Rules (No-Drift)

- No re-ranking. No boosting/penalizing. No language/country/domain caps.
- The only allowed modification is:
  - URL canonicalization (remove fragments + common tracking params)
  - Stable dedup by canonical URL (keep first occurrence)

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
