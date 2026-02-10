# Decisions

- Deploy target: Vercel only. No Firestore/GCP/external DB for MVP.
- Caching: Vercel CDN caching via `CDN-Cache-Control` only for server-owned Brave key responses; BYO key responses are always `private, no-store`.
- "Reality Mode" invariant: Upstream order is preserved; only URL canonicalization + stable dedup is applied.
- Global baseline: Brave Web Search defaults `country` to `US` when omitted, so we force `country=ALL` when no country hint is selected (and ignore provider-unsupported ISO codes).
- Language baseline: Brave Web Search defaults `search_lang` to `en` when omitted. We always send an explicit `search_lang`, inferring it from the query language (franc ISO-639-3) when possible, otherwise falling back to `en` (geo-neutral, avoids hidden English-only defaults for non-English queries).
