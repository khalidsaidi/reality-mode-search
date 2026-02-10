# Decisions

- Deploy target: Vercel only. No Firestore/GCP/external DB for MVP.
- Caching: Vercel CDN caching via `CDN-Cache-Control` only for server-owned Brave key responses; BYO key responses are always `private, no-store`.
- "Reality Mode" invariant: Upstream order is preserved; only URL canonicalization + stable dedup is applied.
- Global baseline: Brave Web Search defaults `country` to `US` when omitted, so we force `country=ALL` when no country hint is selected (and ignore provider-unsupported ISO codes).
