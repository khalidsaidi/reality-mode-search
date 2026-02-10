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

Deployed URL and exact verification commands are recorded in the 2026-02-10 section below.

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

## 2026-02-10

### GitHub Repo

- Created repo: `khalidsaidi/reality-mode-search` (public)
- URL: `https://github.com/khalidsaidi/reality-mode-search`

Create repo (via GitHub API; token read from `.ai/.secret`, not committed):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d '{"name":"reality-mode-search","private":false,"auto_init":false}'
```

Push (HTTPS remote used because SSH keys were not available in this environment):

```bash
git remote set-url origin https://github.com/khalidsaidi/reality-mode-search.git
git push -u origin main
```

### Vercel Project + Env

- Project: `reality-mode-search`
- Production alias: `https://reality-mode-search.vercel.app`

Create/link project:

```bash
vercel project add reality-mode-search
vercel link --yes --project reality-mode-search
```

Set env vars (production + preview):

```bash
vercel env add BRAVE_API_KEY production --sensitive
vercel env add BRAVE_API_KEY preview --sensitive

vercel env add CACHE_TTL_SECONDS production
vercel env add SWR_SECONDS production
vercel env add STALE_IF_ERROR_SECONDS production
vercel env add DAILY_MISS_BUDGET production
vercel env add ENABLE_BYO_KEY production

vercel env add CACHE_TTL_SECONDS preview
vercel env add SWR_SECONDS preview
vercel env add STALE_IF_ERROR_SECONDS preview
vercel env add DAILY_MISS_BUDGET preview
vercel env add ENABLE_BYO_KEY preview
```

Framework preset fix (project was initially created as “Other”, causing deploy error looking for `dist`):

```bash
vercel api /v9/projects/reality-mode-search -X PATCH -F framework=nextjs
```

Deploy:

```bash
vercel deploy --prod --yes
```

GitHub integration note:
- Project is linked to `khalidsaidi/reality-mode-search` (production branch `main`).
- Verified auto-deploy: commit `f8ea9c84303e19167b9753074c45a53992455921` triggered a production deployment `dpl_8ndXEwKXg9DSYsUWZ9ws3p4xKSQQ` (READY).

```bash
vercel git connect https://github.com/khalidsaidi/reality-mode-search.git
```

Verification (requires Vercel token):

```bash
vercel api /v9/projects/reality-mode-search | jq '.link'
vercel api "/v6/deployments?projectId=prj_acr3iLMFoBfl0CbGiHd3kFZSlhHE&limit=1" | jq '.deployments[0].meta.githubCommitSha'
```

### Cache Verification (Deployed)

Server-key (cached):

```bash
curl -sS -D - "https://reality-mode-search.vercel.app/api/search?q=hello" -o /dev/null
curl -sS -D - "https://reality-mode-search.vercel.app/api/search?q=hello" -o /dev/null
```

Observed:
- First: `x-vercel-cache: MISS`
- Second: `x-vercel-cache: HIT`
- Headers include `CDN-Cache-Control: s-maxage=604800, stale-while-revalidate=0, stale-if-error=604800`

BYO (must not be cached):
- Added `Vary: x-user-brave-key` to prevent BYO requests from being served by shared CDN cache entries.
- Purged CDN cache to validate behavior on a clean slate.

```bash
vercel cache purge --type cdn --yes
curl -sS -D - -H "x-user-brave-key: $BRAVE_API_KEY" "https://reality-mode-search.vercel.app/api/search?q=hello" -o /dev/null
curl -sS -D - -H "x-user-brave-key: $BRAVE_API_KEY" "https://reality-mode-search.vercel.app/api/search?q=hello" -o /dev/null
```

Observed:
- `x-vercel-cache: MISS` on repeated BYO calls
- `Cache-Control: private, no-store`
- No `CDN-Cache-Control` header

### Global Baseline (No Geo Lock-In)

Brave Web Search API defaults the `country` parameter to `US` when omitted. To make the default behavior truly worldwide, the backend forces `country=ALL` for requests that do not specify a country hint.

Provider note:
- Brave only supports a subset of country codes (+ `ALL`) for the `country` parameter; unsupported ISO codes are ignored (fallback to `ALL`) instead of erroring.

Verification:

```bash
# Purge shared cache so old US-default entries don't persist.
vercel cache purge --type cdn --yes

# Server-key path (cached): should match Brave country=ALL and cache on repeat.
curl -sS "https://reality-mode-search.vercel.app/api/search?q=football" | jq -r '.results[0:10][].url'

# BYO path (no-store): should match Brave country=ALL and never cache.
curl -sS -H "x-user-brave-key: $BRAVE_API_KEY" "https://reality-mode-search.vercel.app/api/search?q=football" | jq -r '.results[0:10][].url'

# Direct Brave call for comparison.
curl -sS -H "X-Subscription-Token: $BRAVE_API_KEY" "https://api.search.brave.com/res/v1/web/search?q=football&count=20&country=ALL" | jq -r '.web.results[0:10][].url'
```

### Local Behavior Checks

Rate limit (30 req/hour/IP):

```bash
PORT=3015 BRAVE_API_KEY='' ENABLE_BYO_KEY=false npm run start -- -p 3015
```

Made 31 requests to `/api/search?q=hello`:
- 30 returned `503` (no key)
- 1 returned `429` with `Retry-After: 3600`

Daily miss budget guard:

```bash
PORT=3016 BRAVE_API_KEY=invalid DAILY_MISS_BUDGET=1 npm run start -- -p 3016
```

- 1st call returned `503` with `details.upstream_status`
- 2nd call returned `503` without `details` (budget guard triggered)

### Language Baseline (Avoid Implicit English Default)

Brave Web Search defaults `search_lang` to `en` when omitted. This can make “Worldwide” results look English-heavy even for non-English queries. The backend now:

- Infers `search_lang` from the query language (franc ISO-639-3 -> Brave enum), when possible.
- Falls back to `en` and always sends an explicit `search_lang`.
- Supports `lang=all` to omit the language hint (provider default), and `lang=<code>` for an explicit language.

Local verification:

```bash
PORT=3005 BRAVE_API_KEY=$BRAVE_API_KEY npm run start -- -p 3005
curl -sS "http://localhost:3005/api/search?q=plage%20david" | jq '.lens, .reality.histograms.lang_detected[0:5]'
```

Deployed verification (purge cache first, since server-key responses are CDN-cached for 7 days):

```bash
vercel cache purge --type cdn --yes
curl -sS -D - "https://reality-mode-search.vercel.app/api/search?q=plage%20david" -o /tmp/rms_plage_david.json
cat /tmp/rms_plage_david.json | jq '.lens, .reality.histograms.lang_detected[0:5]'
```

Compare with no hint:

```bash
vercel cache purge --type cdn --yes
curl -sS "https://reality-mode-search.vercel.app/api/search?q=plage%20david&lang=all" | jq '.lens, .reality.histograms.lang_detected[0:5]'
```
