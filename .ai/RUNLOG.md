# Run Log

This file records the exact commands and verification steps used while building/deploying.

## 2026-02-09
- Initialized local git repo in `/home/khali/reality-mode-search` (no Node/npm available in this environment; project files are authored manually to match Next.js/shadcn expectations).
- Added Next.js + TS + Tailwind + shadcn-like UI scaffolding, plus API/routes, tests, and CI workflow.

### Suggested Local Commands (run on a machine with Node.js)

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

### Vercel Cache Verification

1. Set env vars in Vercel:
   - `BRAVE_API_KEY` (optional but recommended for public demo)
   - `CACHE_TTL_SECONDS=604800`
   - `SWR_SECONDS=0`
   - `STALE_IF_ERROR_SECONDS=604800`
   - `DAILY_MISS_BUDGET=1500`
   - `ENABLE_BYO_KEY=true`
2. Deploy.
3. Verify CDN caching (server-key path):
   - Call `/api/search?q=hello` twice (no BYO header).
   - Second response should include `x-vercel-cache=HIT`.
4. Verify BYO is not cached:
   - Call `/api/search?q=hello` with `x-user-brave-key`.
   - Response should be `Cache-Control: private, no-store` and must not be cached.

TODO: Add deployed URL + exact curl commands after first deploy.
