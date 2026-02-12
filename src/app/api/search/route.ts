import { NextRequest, NextResponse } from "next/server";

import { inferCountryFromTld } from "@/lib/countryInfer";
import { detectLang } from "@/lib/lang";
import { normalizeQuery } from "@/lib/normalize";
import {
  buildProviderAttempts,
  executeProviderAttempt,
  hasAnyProviderKey,
  hasAnyUserProviderKey,
  parseCountryHint,
  resolveLanguagePlan,
} from "@/lib/providerRouter";
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

let serverKeyDailyMissState: { date: string; misses: number } = { date: "", misses: 0 };

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

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return raw.toLowerCase() === "true";
}

function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

function setVaryUserKeys(res: NextResponse) {
  const headers = ["x-user-brave-key", "x-user-serpapi-key", "x-user-searchapi-key"];
  const existing = res.headers.get("Vary");
  if (!existing) {
    res.headers.set("Vary", headers.join(", "));
    return;
  }
  if (existing.trim() === "*") return;

  const parts = existing
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const merged = [...parts];
  for (const h of headers) {
    if (!merged.includes(h)) merged.push(h);
  }
  res.headers.set("Vary", merged.join(", "));
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

function consumeServerMissBudget(dailyMissBudget: number): boolean {
  const today = todayUtc();
  if (serverKeyDailyMissState.date !== today) {
    serverKeyDailyMissState = { date: today, misses: 0 };
  }

  if (serverKeyDailyMissState.misses >= dailyMissBudget) {
    return false;
  }

  serverKeyDailyMissState.misses += 1;
  return true;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.allowed) {
    const res = json<ErrorResponse>({ error: "Rate limit exceeded. Try later." }, { status: 429 });
    res.headers.set("Retry-After", String(rl.retryAfterSeconds));
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  const reqUrl = new URL(req.url);
  const qRaw = reqUrl.searchParams.get("q") ?? "";
  const normalizedQ = normalizeQuery(qRaw);

  if (!normalizedQ) {
    const res = json<ErrorResponse>({ error: "Missing required query parameter: q" }, { status: 400 });
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  const countryHint = parseCountryHint(reqUrl.searchParams.get("country"));
  const languagePlan = resolveLanguagePlan(normalizedQ, reqUrl.searchParams.get("lang"));

  const enableByo = envBool("ENABLE_BYO_KEY", true);
  const keys = {
    user: {
      brave: enableByo ? (req.headers.get("x-user-brave-key") ?? "").trim() : "",
      serpapi: enableByo ? (req.headers.get("x-user-serpapi-key") ?? "").trim() : "",
      searchapi: enableByo ? (req.headers.get("x-user-searchapi-key") ?? "").trim() : "",
    },
    server: {
      brave: (process.env.BRAVE_API_KEY ?? "").trim(),
      serpapi: (process.env.SERPAPI_API_KEY ?? "").trim(),
      searchapi: (process.env.SEARCHAPI_API_KEY ?? "").trim(),
    },
  };

  if (!hasAnyProviderKey(keys)) {
    const res = json<ErrorResponse>(
      {
        error:
          "No upstream key configured. Provide one of: x-user-brave-key, x-user-serpapi-key, x-user-searchapi-key.",
      },
      { status: 503 },
    );
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  const attempts = buildProviderAttempts(countryHint, keys);
  if (attempts.length === 0) {
    const res = json<ErrorResponse>(
      {
        error: "No provider route available for this request. Configure at least one provider key.",
      },
      { status: 503 },
    );
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  const ttlSeconds = envInt("CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS);
  const swrSeconds = envInt("SWR_SECONDS", DEFAULT_SWR_SECONDS);
  const staleIfErrorSeconds = envInt("STALE_IF_ERROR_SECONDS", DEFAULT_STALE_IF_ERROR_SECONDS);
  const dailyMissBudget = envInt("DAILY_MISS_BUDGET", DEFAULT_DAILY_MISS_BUDGET);

  const hasAnyUserKey = hasAnyUserProviderKey(keys);

  const attemptTrace: Array<{
    provider: string;
    status: number;
    key_source: "user" | "server";
    reason: string;
    exact_country_applied: boolean;
  }> = [];

  let selected:
    | {
        attempt: (typeof attempts)[number];
        results: SearchResult[];
      }
    | null = null;

  for (const attempt of attempts) {
    if (attempt.keySource === "server") {
      const budgetAllowed = consumeServerMissBudget(dailyMissBudget);
      if (!budgetAllowed) {
        attemptTrace.push({
          provider: attempt.provider,
          status: 503,
          key_source: attempt.keySource,
          reason: "daily_miss_budget_exceeded",
          exact_country_applied: attempt.exactCountryApplied,
        });
        continue;
      }
    }

    const upstream = await executeProviderAttempt(attempt, {
      q: normalizedQ,
      languagePlan,
    });

    attemptTrace.push({
      provider: attempt.provider,
      status: upstream.status,
      key_source: attempt.keySource,
      reason: attempt.reason,
      exact_country_applied: attempt.exactCountryApplied,
    });

    if (!upstream.ok) continue;

    const mapped: SearchResult[] = upstream.results.map((r) => {
      const url = r.url;
      const title = r.title;
      const snippet = r.snippet;
      const display_url = r.display_url;
      const domain = getDomain(url);
      const tld = getTld(domain);
      const country_inferred = inferCountryFromTld(tld);
      const lang_detected = detectLang([title, snippet].filter(Boolean).join(" "));

      return { title, url, snippet, display_url, domain, tld, country_inferred, lang_detected };
    });

    selected = { attempt, results: mapped };
    break;
  }

  if (!selected) {
    const res = json<ErrorResponse>(
      {
        error: "Live refresh paused/throttled to stay free. Try later or provide your own provider key.",
        details: {
          attempts: attemptTrace,
        },
      },
      { status: 503 },
    );

    if (!hasAnyUserKey) setServerShortCdnCache(res);
    else setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  const deduped = dedupByCanonicalUrl(selected.results);
  const dedupedCount = selected.results.length - deduped.length;

  const response: SearchResponse = {
    query: qRaw,
    normalized_query: normalizedQ,
    lens: {
      mode: "reality",
      country_hint: countryHint,
      lang_hint: languagePlan.langHint,
      search_lang: languagePlan.searchLang,
      search_lang_source: languagePlan.searchLangSource,
    },
    results: deduped,
    reality: computeRealityPanel(deduped),
    cache: {
      mode: hasAnyUserKey ? "no-store" : "vercel-cdn",
      ttl_seconds: hasAnyUserKey ? 0 : ttlSeconds,
      swr_seconds: hasAnyUserKey ? 0 : swrSeconds,
      stale_if_error_seconds: hasAnyUserKey ? 0 : staleIfErrorSeconds,
    },
    meta: {
      provider: selected.attempt.provider,
      providers_tried: attemptTrace.map((t) => t.provider),
      provider_key_source: selected.attempt.keySource,
      provider_route_reason: selected.attempt.reason,
      requested_country_supported_by_provider: selected.attempt.providerSupportsCountry,
      exact_country_applied: selected.attempt.exactCountryApplied,
      applied_country_param: selected.attempt.countryParam,
      fetched_with: selected.attempt.keySource === "user" ? "user_key" : "server_key",
      deduped: dedupedCount,
      returned: deduped.length,
      build: { sha: getBuildSha() },
    },
  };

  const res = json<SearchResponse>(response, { status: 200 });

  if (hasAnyUserKey) {
    setNoStore(res);
  } else {
    setServerCdnCache(res, ttlSeconds, swrSeconds, staleIfErrorSeconds);
  }
  setVaryUserKeys(res);

  return res;
}
