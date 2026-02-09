const TRACKING_PARAMS = new Set(["gclid", "fbclid", "mc_cid", "mc_eid", "igshid"]);

export function canonicalizeUrl(rawUrl: string): string {
  const input = rawUrl.trim();
  if (!input) return "";

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  const kept: Array<[string, string]> = [];
  for (const [k, v] of url.searchParams.entries()) {
    const key = k.toLowerCase();
    if (key.startsWith("utm_")) continue;
    if (TRACKING_PARAMS.has(key)) continue;
    kept.push([k, v]);
  }

  kept.sort((a, b) => {
    const kc = a[0].localeCompare(b[0]);
    return kc !== 0 ? kc : a[1].localeCompare(b[1]);
  });

  url.search = kept.length ? new URLSearchParams(kept).toString() : "";
  return url.toString();
}

export function dedupByCanonicalUrl<T extends { url: string }>(results: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of results) {
    const raw = (r.url ?? "").trim();
    if (!raw) {
      // No URL to key on; keep as-is to avoid "filtering" results.
      out.push(r);
      continue;
    }

    const canon = canonicalizeUrl(raw) || raw;
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push(r);
  }
  return out;
}
