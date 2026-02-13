import { NextRequest, NextResponse } from "next/server";

import { searchCommonCrawl } from "@/lib/commonCrawl";
import { parseCountryCode, resolveCountryTarget } from "@/lib/countryTargeting";
import { inferCountryFromTld } from "@/lib/countryInfer";
import { normalizeQuery } from "@/lib/normalize";
import { computeRealityPanel } from "@/lib/reality";
import { getDomain, getTld } from "@/lib/tld";
import type { CountryCode } from "@/lib/isoCountries";
import type { SearchResult } from "@/lib/types";
import { dedupByCanonicalUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CACHE_TTL_SECONDS = 604800; // 7 days
const DEFAULT_SWR_SECONDS = 0;
const DEFAULT_STALE_IF_ERROR_SECONDS = 604800; // 7 days
const DEFAULT_DAILY_MISS_BUDGET = 1500;

// Allow a full 249 sweep from one client within an hour, but still prevent abuse.
const COMPARE_LIMIT = 400;
const COMPARE_WINDOW_MS = 60 * 60 * 1000;
const compareBuckets = new Map<string, number[]>();

let openDataDailyMissState: { date: string; misses: number } = { date: "", misses: 0 };

type ProbeSummary = {
  returned: number;
  top_results: Array<{
    title: string;
    url: string;
    domain: string;
    tld: string;
    country_inferred: string;
    lang_detected: string;
  }>;
  top_domains: Array<{ key: string; count: number; pct: number }>;
};

type ProbeResponse = {
  query: string;
  normalized_query: string;
  country: CountryCode;
  provider_supported: boolean;
  status: "ok" | "unsupported" | "upstream_error";
  lens: {
    country_hint: CountryCode;
    lang_hint: string | null;
    search_lang: string;
    search_lang_source: "provider_default";
  };
  routing: {
    selected_provider?: string;
    selected_key_source?: "none";
    exact_country_applied?: boolean;
    country_resolution?: "exact" | "proxy" | "global";
    resolved_country?: string | null;
    route_reason?: string;
    attempts: Array<{
      provider: string;
      status: number;
      key_source: "none";
      reason: string;
      exact_country_applied: boolean;
      country_resolution: "exact" | "proxy" | "global";
      resolved_country: string | null;
    }>;
  };
  summary?: ProbeSummary;
  error?: string;
  debug?: {
    index: string;
    request_url: string;
    upstream_status: number;
  };
};

function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "unknown";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function consumeOpenDataMissBudget(dailyMissBudget: number): boolean {
  const today = todayUtc();
  if (openDataDailyMissState.date !== today) {
    openDataDailyMissState = { date: today, misses: 0 };
  }

  if (openDataDailyMissState.misses >= dailyMissBudget) return false;
  openDataDailyMissState.misses += 1;
  return true;
}

function rateLimitCompare(ip: string, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const key = ip || "unknown";
  const times = compareBuckets.get(key) ?? [];
  const cutoff = nowMs - COMPARE_WINDOW_MS;
  while (times.length > 0 && times[0] < cutoff) times.shift();

  if (times.length >= COMPARE_LIMIT) {
    const oldest = times[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + COMPARE_WINDOW_MS - nowMs) / 1000));
    compareBuckets.set(key, times);
    return { allowed: false, retryAfterSeconds };
  }

  times.push(nowMs);
  compareBuckets.set(key, times);
  return { allowed: true, retryAfterSeconds: 0 };
}

function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

function setNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Pragma", "no-cache");
}

function setServerCdnCache(res: NextResponse, ttlSeconds: number, swrSeconds: number, staleIfErrorSeconds: number) {
  res.headers.set("Cache-Control", "max-age=0");
  res.headers.set(
    "CDN-Cache-Control",
    `s-maxage=${ttlSeconds}, stale-while-revalidate=${swrSeconds}, stale-if-error=${staleIfErrorSeconds}`,
  );
}

function setServerShortCdnCache(res: NextResponse) {
  res.headers.set("Cache-Control", "max-age=0");
  res.headers.set("CDN-Cache-Control", "s-maxage=60");
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimitCompare(ip);
  if (!rl.allowed) {
    const res = json({ error: "Rate limit exceeded. Try later." }, { status: 429 });
    res.headers.set("Retry-After", String(rl.retryAfterSeconds));
    setNoStore(res);
    return res;
  }

  const reqUrl = new URL(req.url);
  const qRaw = reqUrl.searchParams.get("q") ?? "";
  const normalizedQ = normalizeQuery(qRaw);
  const country = parseCountryCode(reqUrl.searchParams.get("country"));
  const debug = reqUrl.searchParams.get("debug") === "1";

  if (!normalizedQ) {
    const res = json({ error: "Missing required query parameter: q" }, { status: 400 });
    setNoStore(res);
    return res;
  }

  if (!country) {
    const res = json({ error: "Missing or invalid required country code." }, { status: 400 });
    setNoStore(res);
    return res;
  }

  const target = resolveCountryTarget(country);
  const tokens = normalizedQ
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  const ttlSeconds = envInt("CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS);
  const swrSeconds = envInt("SWR_SECONDS", DEFAULT_SWR_SECONDS);
  const staleIfErrorSeconds = envInt("STALE_IF_ERROR_SECONDS", DEFAULT_STALE_IF_ERROR_SECONDS);
  const dailyMissBudget = envInt("DAILY_MISS_BUDGET", DEFAULT_DAILY_MISS_BUDGET);

  const base: Omit<ProbeResponse, "status"> = {
    query: qRaw,
    normalized_query: normalizedQ,
    country,
    provider_supported: true,
    lens: {
      country_hint: country,
      lang_hint: null,
      search_lang: "none",
      search_lang_source: "provider_default",
    },
    routing: {
      attempts: [],
    },
  };

  const budgetAllowed = consumeOpenDataMissBudget(dailyMissBudget);
  if (!budgetAllowed) {
    const res = json<ProbeResponse>(
      {
        ...base,
        status: "upstream_error",
        error: "Live refresh paused/throttled to stay sustainable. Try later.",
      },
      { status: 503 },
    );
    setServerShortCdnCache(res);
    return res;
  }

  const upstream = await searchCommonCrawl({ target, query_tokens: tokens, limit: 20 });
  base.routing.attempts.push({
    provider: "commoncrawl",
    status: upstream.status,
    key_source: "none",
    reason: target.country_resolution === "proxy" ? "proxy_tld" : "exact_tld",
    exact_country_applied: target.country_resolution === "exact",
    country_resolution: target.country_resolution,
    resolved_country: target.resolved_country,
  });

  if (!upstream.ok) {
    const res = json<ProbeResponse>(
      {
        ...base,
        status: "upstream_error",
        error: "Common Crawl index temporarily unavailable. Try later.",
        ...(debug ? { debug: { index: upstream.index, request_url: upstream.request_url, upstream_status: upstream.status } } : {}),
      },
      { status: 503 },
    );
    setServerShortCdnCache(res);
    return res;
  }

  const mapped: SearchResult[] = upstream.results.map((r) => {
    const url = r.url;
    const title = r.title;
    const snippet = r.snippet;
    const display_url = r.display_url;
    const domain = getDomain(url);
    const tld = getTld(domain);
    const country_inferred = inferCountryFromTld(tld);
    const lang_detected = r._cc.languages?.split(",")[0]?.trim() || "unknown";
    return { title, url, snippet, display_url, domain, tld, country_inferred, lang_detected };
  });

  const deduped = dedupByCanonicalUrl(mapped);
  const reality = computeRealityPanel(deduped);

  const summary: ProbeSummary = {
    returned: deduped.length,
    top_results: deduped.slice(0, 3).map((r) => ({
      title: r.title,
      url: r.url,
      domain: r.domain,
      tld: r.tld,
      country_inferred: r.country_inferred,
      lang_detected: r.lang_detected,
    })),
    top_domains: reality.histograms.top_domains.slice(0, 3),
  };

  const res = json<ProbeResponse>({
    ...base,
    status: "ok",
    routing: {
      ...base.routing,
      selected_provider: "commoncrawl",
      selected_key_source: "none",
      exact_country_applied: target.country_resolution === "exact",
      country_resolution: target.country_resolution,
      resolved_country: target.resolved_country,
      route_reason: target.country_resolution === "proxy" ? "proxy_tld" : "exact_tld",
    },
    summary,
    ...(debug ? { debug: { index: upstream.index, request_url: upstream.request_url, upstream_status: upstream.status } } : {}),
  });

  setServerCdnCache(res, ttlSeconds, swrSeconds, staleIfErrorSeconds);
  return res;
}
