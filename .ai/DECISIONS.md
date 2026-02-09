# Decisions

- Deploy target: Vercel only. No Firestore/GCP/external DB for MVP.
- Caching: Vercel CDN caching via `CDN-Cache-Control` only for server-owned Brave key responses; BYO key responses are always `private, no-store`.
- "Reality Mode" invariant: Upstream order is preserved; only URL canonicalization + stable dedup is applied.

