import { NextRequest, NextResponse } from "next/server";

import { searchCommonCrawl } from "@/lib/commonCrawl";
import { parseCountryCode, resolveCountryTarget } from "@/lib/countryTargeting";
import { inferCountryFromTld } from "@/lib/countryInfer";
import { normalizeQuery } from "@/lib/normalize";
import { computeRealityPanel } from "@/lib/reality";
import { rateLimit } from "@/lib/rateLimit";
import { getDomain, getTld } from "@/lib/tld";
import type { ErrorResponse, SearchResponse, SearchResult } from "@/lib/types";
import { dedupByCanonicalUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CACHE_TTL_SECONDS = 604800; // 7 days
const DEFAULT_SWR_SECONDS = 0;
const DEFAULT_STALE_IF_ERROR_SECONDS = 604800; // 7 days
const DEFAULT_DAILY_MISS_BUDGET = 1500;

let openDataDailyMissState: { date: string; misses: number } = { date: "", misses: 0 };

function getBuildSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "dev";
}

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

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.allowed) {
    const res = json<ErrorResponse>({ error: "Rate limit exceeded. Try later." }, { status: 429 });
    res.headers.set("Retry-After", String(rl.retryAfterSeconds));
    setNoStore(res);
    return res;
  }

  const reqUrl = new URL(req.url);
  const qRaw = reqUrl.searchParams.get("q") ?? "";
  const normalizedQ = normalizeQuery(qRaw);

  if (!normalizedQ) {
    const res = json<ErrorResponse>({ error: "Missing required query parameter: q" }, { status: 400 });
    setNoStore(res);
    return res;
  }

  const countryHint = parseCountryCode(reqUrl.searchParams.get("country"));
  if (!countryHint) {
    const res = json<ErrorResponse>(
      { error: "Open-data mode requires a valid ISO country hint. Pick a country or use the 249-country sweep." },
      { status: 400 },
    );
    setNoStore(res);
    return res;
  }

  const target = resolveCountryTarget(countryHint);

  const ttlSeconds = envInt("CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS);
  const swrSeconds = envInt("SWR_SECONDS", DEFAULT_SWR_SECONDS);
  const staleIfErrorSeconds = envInt("STALE_IF_ERROR_SECONDS", DEFAULT_STALE_IF_ERROR_SECONDS);
  const dailyMissBudget = envInt("DAILY_MISS_BUDGET", DEFAULT_DAILY_MISS_BUDGET);

  const budgetAllowed = consumeOpenDataMissBudget(dailyMissBudget);
  if (!budgetAllowed) {
    const res = json<ErrorResponse>(
      {
        error: "Live refresh paused/throttled to stay sustainable. Try later.",
        details: { reason: "daily_miss_budget_exceeded" },
      },
      { status: 503 },
    );
    setServerShortCdnCache(res);
    return res;
  }

  const tokens = normalizedQ
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  const upstream = await searchCommonCrawl({
    target,
    query_tokens: tokens,
    limit: 20,
  });

  if (!upstream.ok) {
    const res = json<ErrorResponse>(
      {
        error: "Common Crawl index temporarily unavailable. Try later.",
        details: { status: upstream.status, index: upstream.index, error: upstream.error },
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
  const dedupedCount = mapped.length - deduped.length;

  const response: SearchResponse = {
    query: qRaw,
    normalized_query: normalizedQ,
    lens: {
      mode: "reality",
      country_hint: countryHint,
      lang_hint: null,
      search_lang: "none",
      search_lang_source: "provider_default",
    },
    results: deduped,
    reality: computeRealityPanel(deduped),
    cache: {
      mode: "vercel-cdn",
      ttl_seconds: ttlSeconds,
      swr_seconds: swrSeconds,
      stale_if_error_seconds: staleIfErrorSeconds,
    },
    meta: {
      provider: "commoncrawl",
      providers_tried: ["commoncrawl"],
      provider_key_source: "none",
      provider_route_reason: target.country_resolution === "proxy" ? "proxy_tld" : "exact_tld",
      requested_country_supported_by_provider: true,
      exact_country_applied: target.country_resolution === "exact",
      country_resolution: target.country_resolution,
      resolved_country: target.resolved_country,
      applied_country_param: target.tld,
      fetched_with: "none",
      deduped: dedupedCount,
      returned: deduped.length,
      build: { sha: getBuildSha() },
    },
  };

  const res = json<SearchResponse>(response, { status: 200 });
  setServerCdnCache(res, ttlSeconds, swrSeconds, staleIfErrorSeconds);
  return res;
}
