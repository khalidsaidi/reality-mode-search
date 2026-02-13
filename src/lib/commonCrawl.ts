import type { CountryTarget } from "@/lib/countryTargeting";

export type CommonCrawlSearchOptions = {
  target: CountryTarget;
  query_tokens: string[];
  limit: number;
};

export type CommonCrawlRawRecord = {
  url?: string;
  timestamp?: string;
  status?: string;
  mime?: string;
  "mime-detected"?: string;
  languages?: string;
  filename?: string;
  offset?: string;
  length?: string;
};

export type CommonCrawlSearchResult = {
  url: string;
  title: string;
  snippet: string;
  display_url: string;
  _cc: {
    index: string;
    timestamp?: string;
    languages?: string;
  };
};

function escapeRegexLiteral(input: string): string {
  // Escape characters which are meaningful in regex patterns.
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveDisplayUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return urlStr;
  }
}

let cachedIndexId: { id: string; fetchedAtMs: number } | null = null;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

function getIndexBaseUrl(): string {
  const raw = (process.env.COMMONCRAWL_INDEX_BASE_URL ?? "").trim();
  const base = raw || "http://index.commoncrawl.org";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

async function getIndexId(): Promise<string> {
  const pinned = (process.env.COMMONCRAWL_INDEX_ID ?? "").trim();
  if (pinned) return pinned;

  if (cachedIndexId && Date.now() - cachedIndexId.fetchedAtMs < INDEX_TTL_MS) return cachedIndexId.id;

  const baseUrl = getIndexBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${baseUrl}/collinfo.json`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "reality-mode-search (+https://github.com/khalidsaidi/reality-mode-search)",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`CommonCrawl collinfo.json error: ${res.status}`);
    const data = (await res.json().catch(() => null)) as unknown;
    const arr = Array.isArray(data) ? data : [];
    const id = typeof arr[0]?.id === "string" ? (arr[0].id as string) : "";
    if (!id) throw new Error("CommonCrawl collinfo.json missing id");
    cachedIndexId = { id, fetchedAtMs: Date.now() };
    return id;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCdxUrl(indexId: string, opts: CommonCrawlSearchOptions): URL {
  const baseUrl = getIndexBaseUrl();
  const url = new URL(`${baseUrl}/${indexId}-index`);
  // Using `matchType=domain` with `.tld` avoids expensive wildcard patterns like `*.tld/*`.
  url.searchParams.set("url", `.${opts.target.tld}`);
  url.searchParams.set("matchType", "domain");
  url.searchParams.set("output", "json");
  url.searchParams.set("limit", String(opts.limit));

  // Keep queries small and polite. Prefer signal-like filters.
  url.searchParams.append("filter", "status:200");
  // Match both `text/html` and `application/xhtml+xml` without relying on alternation.
  url.searchParams.append("filter", "mime-detected:html");

  for (const token of opts.query_tokens) {
    const t = token.trim().toLowerCase();
    if (!t) continue;
    // CDX filters are regex patterns. Escape to treat query tokens as literals.
    url.searchParams.append("filter", `url:${escapeRegexLiteral(t)}`);
  }

  return url;
}

function parseNdjson(text: string): CommonCrawlRawRecord[] {
  const out: CommonCrawlRawRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s) as unknown;
      if (obj && typeof obj === "object") out.push(obj as CommonCrawlRawRecord);
    } catch {
      // ignore
    }
  }
  return out;
}

export async function searchCommonCrawl(opts: CommonCrawlSearchOptions): Promise<{
  ok: boolean;
  status: number;
  index: string;
  request_url: string;
  results: CommonCrawlSearchResult[];
  error?: string;
}> {
  const indexId = await getIndexId();
  const url = buildCdxUrl(indexId, opts);
  const requestUrl = url.toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "reality-mode-search (+https://github.com/khalidsaidi/reality-mode-search)",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    // Common Crawl returns 404 for "no captures found".
    if (res.status === 404) return { ok: true, status: 404, index: indexId, request_url: requestUrl, results: [] };

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        index: indexId,
        request_url: requestUrl,
        results: [],
        error: text.slice(0, 500),
      };
    }

    // Occasionally the index server can reply with an HTML error page (despite a 200).
    // Treat this as an upstream error so we don't return a misleading empty result set.
    if (!contentType.includes("json") && !contentType.includes("ndjson")) {
      return {
        ok: false,
        status: 502,
        index: indexId,
        request_url: requestUrl,
        results: [],
        error: `Unexpected content-type: ${contentType || "unknown"}`,
      };
    }

    const rows = parseNdjson(text);
    if (rows.length === 0 && text.trim().length > 0) {
      return {
        ok: false,
        status: 502,
        index: indexId,
        request_url: requestUrl,
        results: [],
        error: `Failed to parse NDJSON (first 200 chars): ${text.trim().slice(0, 200)}`,
      };
    }
    const results: CommonCrawlSearchResult[] = [];
    for (const r of rows) {
      const urlStr = typeof r.url === "string" ? r.url : "";
      if (!urlStr) continue;

      const snippetParts = [
        "Common Crawl",
        indexId,
        r.timestamp ? `@ ${r.timestamp}` : null,
        r.languages ? `langs: ${r.languages}` : null,
      ].filter(Boolean);

      results.push({
        url: urlStr,
        title: urlStr,
        snippet: snippetParts.join(" "),
        display_url: deriveDisplayUrl(urlStr),
        _cc: {
          index: indexId,
          ...(r.timestamp ? { timestamp: r.timestamp } : {}),
          ...(r.languages ? { languages: r.languages } : {}),
        },
      });
    }

    return { ok: true, status: res.status, index: indexId, request_url: requestUrl, results };
  } catch (e) {
    return { ok: false, status: 0, index: indexId, request_url: requestUrl, results: [], error: String(e) };
  } finally {
    clearTimeout(timeout);
  }
}
