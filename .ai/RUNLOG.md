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

### Executed In This Environment (Node available)

```bash
node -v
npm -v

npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Start verification:

```bash
PORT=3005 npm run start -- -p 3005
curl http://localhost:3005/api/healthz
```

API header spot-checks (local):
- No key configured: `/api/search?q=hello` returns `503` with `Cache-Control: private, no-store`.
- BYO key header: `/api/search?q=hello` returns `503` (with invalid key) and is still `private, no-store`.
- Server key set but upstream error: returns `503` with `CDN-Cache-Control: s-maxage=60`.

## GitHub/Vercel Provisioning (pending auth)

```bash
git remote add origin git@github.com:khalidsaidi/reality-mode-search.git
git push -u origin main
```

Notes:
- Push failed in this environment due to missing SSH credentials and because the GitHub repo did not yet exist.
- Next step is to create the GitHub repo (public) and authenticate (PAT or SSH key), then push.
- After push, import into Vercel and set env vars.
