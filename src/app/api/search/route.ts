import { NextRequest, NextResponse } from "next/server";

import { inferCountryFromTld } from "@/lib/countryInfer";
import { detectLang } from "@/lib/lang";
import { normalizeQuery } from "@/lib/normalize";
import { computeRealityPanel } from "@/lib/reality";
import { rateLimit } from "@/lib/rateLimit";
import { getDomain, getTld } from "@/lib/tld";
import type { CountryCode } from "@/lib/isoCountries";
import { ISO_COUNTRY_CODES } from "@/lib/isoCountries";
import type { ErrorResponse, FetchedWith, SearchResponse, SearchResult } from "@/lib/types";
import { dedupByCanonicalUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CACHE_TTL_SECONDS = 604800; // 7 days
const DEFAULT_SWR_SECONDS = 0;
const DEFAULT_STALE_IF_ERROR_SECONDS = 604800; // 7 days
const DEFAULT_DAILY_MISS_BUDGET = 1500;

// Brave Web Search "country" defaults to US if omitted; use "ALL" for a truly worldwide baseline.
type BraveSearchCountry = CountryCode | "ALL";
const BRAVE_GLOBAL_COUNTRY: BraveSearchCountry = "ALL";
const BRAVE_SUPPORTED_COUNTRIES = new Set<string>([
  "AR",
  "AU",
  "AT",
  "BE",
  "BR",
  "CA",
  "CL",
  "DK",
  "FI",
  "FR",
  "DE",
  "GR",
  "HK",
  "IN",
  "ID",
  "IT",
  "JP",
  "KR",
  "MY",
  "MX",
  "NL",
  "NZ",
  "NO",
  "CN",
  "PL",
  "PT",
  "PH",
  "RU",
  "SA",
  "ZA",
  "ES",
  "SE",
  "CH",
  "TW",
  "TR",
  "GB",
  "US",
  "ALL",
]);

let serverKeyDailyMissState: { date: string; misses: number } = { date: "", misses: 0 };

function getBuildSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "dev";
}

function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  // NextRequest.ip isn't always available across runtimes.
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

function setVaryUserKey(res: NextResponse) {
  const header = "x-user-brave-key";
  const existing = res.headers.get("Vary");
  if (!existing) {
    res.headers.set("Vary", header);
    return;
  }
  if (existing.trim() === "*") return;
  const parts = existing
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes(header)) return;
  res.headers.set("Vary", `${existing}, ${header}`);
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

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
  display_url?: string;
};

type BraveSearchResponse = {
  web?: { results?: BraveWebResult[] };
  results?: BraveWebResult[];
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
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

async function braveSearch(params: { q: string; country: BraveSearchCountry; key: string }) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", params.q);
  url.searchParams.set("count", "20");
  url.searchParams.set("country", params.country);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Subscription-Token": params.key,
          "Accept": "application/json"
        },
        signal: controller.signal
      });

      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        data = null;
      }

      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.allowed) {
    const res = json<ErrorResponse>({ error: "Rate limit exceeded. Try later." }, { status: 429 });
    res.headers.set("Retry-After", String(rl.retryAfterSeconds));
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const reqUrl = new URL(req.url);
  const qRaw = reqUrl.searchParams.get("q") ?? "";
  const normalizedQ = normalizeQuery(qRaw);

  if (!normalizedQ) {
    const res = json<ErrorResponse>({ error: "Missing required query parameter: q" }, { status: 400 });
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const countryRaw = reqUrl.searchParams.get("country");
  const countryUpper = countryRaw ? countryRaw.toUpperCase() : null;
  const countryHintRequested =
    countryUpper && (ISO_COUNTRY_CODES as readonly string[]).includes(countryUpper)
      ? (countryUpper as CountryCode)
      : null;
  // Provider constraint: Brave only supports a subset of country codes plus "ALL".
  // If the user selects an unsupported ISO code, ignore it (robust "reality mode").
  const countryHint =
    countryHintRequested && BRAVE_SUPPORTED_COUNTRIES.has(countryHintRequested) ? countryHintRequested : null;

  const enableByo = envBool("ENABLE_BYO_KEY", true);
  const userKey = enableByo ? (req.headers.get("x-user-brave-key") ?? "").trim() : "";
  const serverKey = (process.env.BRAVE_API_KEY ?? "").trim();

  let fetchedWith: FetchedWith = "none";
  let keyToUse = "";
  if (userKey) {
    fetchedWith = "user_key";
    keyToUse = userKey;
  } else if (serverKey) {
    fetchedWith = "server_key";
    keyToUse = serverKey;
  } else {
    const res = json<ErrorResponse>(
      { error: "No upstream key configured. Provide your own Brave key." },
      { status: 503 },
    );
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const ttlSeconds = envInt("CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS);
  const swrSeconds = envInt("SWR_SECONDS", DEFAULT_SWR_SECONDS);
  const staleIfErrorSeconds = envInt("STALE_IF_ERROR_SECONDS", DEFAULT_STALE_IF_ERROR_SECONDS);
  const dailyMissBudget = envInt("DAILY_MISS_BUDGET", DEFAULT_DAILY_MISS_BUDGET);

  // Soft daily miss budget guard (server key only).
  if (fetchedWith === "server_key") {
    const today = todayUtc();
    if (serverKeyDailyMissState.date !== today) serverKeyDailyMissState = { date: today, misses: 0 };
    if (serverKeyDailyMissState.misses >= dailyMissBudget) {
      const res = json<ErrorResponse>(
        {
          error: "Live refresh paused/throttled to stay free. Try later or use your own Brave key."
        },
        { status: 503 },
      );
      setServerShortCdnCache(res);
      setVaryUserKey(res);
      return res;
    }
    serverKeyDailyMissState.misses += 1;
  }

  const upstreamCountry: BraveSearchCountry = countryHint ?? BRAVE_GLOBAL_COUNTRY;
  const upstream = await braveSearch({ q: normalizedQ, country: upstreamCountry, key: keyToUse });

  // Upstream errors: treat as 503. Server key gets a short CDN cache to avoid hammering.
  if (!upstream.ok) {
    const res = json<ErrorResponse>(
      {
        error: "Live refresh paused/throttled to stay free. Try later or use your own Brave key.",
        details: { upstream_status: upstream.status }
      },
      { status: 503 },
    );

    if (fetchedWith === "server_key") setServerShortCdnCache(res);
    else setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const braveData = upstream.data as BraveSearchResponse | null;
  const webResults: BraveWebResult[] = braveData?.web?.results ?? braveData?.results ?? [];

  const mapped: SearchResult[] = webResults.map((r) => {
    const url = asString(r.url);
    const title = asString(r.title);
    const snippet = asString(r.description || r.snippet);
    const display_url = asString(r.display_url) || deriveDisplayUrl(url);
    const domain = getDomain(url);
    const tld = getTld(domain);
    const country_inferred = inferCountryFromTld(tld);
    const lang_detected = detectLang([title, snippet].filter(Boolean).join(" "));

    return { title, url, snippet, display_url, domain, tld, country_inferred, lang_detected };
  });

  const deduped = dedupByCanonicalUrl(mapped);
  const dedupedCount = mapped.length - deduped.length;

  const response: SearchResponse = {
    query: qRaw,
    normalized_query: normalizedQ,
    lens: { mode: "reality", country_hint: countryHint },
    results: deduped,
    reality: computeRealityPanel(deduped),
    cache: {
      mode: fetchedWith === "user_key" ? "no-store" : "vercel-cdn",
      ttl_seconds: fetchedWith === "user_key" ? 0 : ttlSeconds,
      swr_seconds: fetchedWith === "user_key" ? 0 : swrSeconds,
      stale_if_error_seconds: fetchedWith === "user_key" ? 0 : staleIfErrorSeconds
    },
    meta: {
      provider: "brave",
      fetched_with: fetchedWith,
      deduped: dedupedCount,
      returned: deduped.length,
      build: { sha: getBuildSha() }
    }
  };

  const res = json<SearchResponse>(response, { status: 200 });

  if (fetchedWith === "user_key") {
    setNoStore(res);
  } else {
    setServerCdnCache(res, ttlSeconds, swrSeconds, staleIfErrorSeconds);
  }
  setVaryUserKey(res);

  return res;
}
