import {
  BRAVE_GLOBAL_COUNTRY,
  BRAVE_SUPPORTED_COUNTRIES,
  type BraveSearchCountry,
} from "@/lib/brave";
import type { CountryCode } from "@/lib/isoCountries";
import { ISO_COUNTRY_CODES } from "@/lib/isoCountries";

export type ProviderId = "brave" | "serpapi" | "searchapi";
export type ProviderKeySource = "user" | "server";
export type SearchLangSource = "explicit" | "provider_default" | "inferred_from_query" | "fallback_en";
export type CountryResolutionMode = "exact" | "proxy" | "global";

export type ProviderKeys = {
  user: Partial<Record<ProviderId, string>>;
  server: Partial<Record<ProviderId, string>>;
};

export type SearchLanguagePlan = {
  langHint: string | null;
  searchLang: string;
  searchLangSource: SearchLangSource;
  braveSearchLangParam: null;
  googleHlParam: string | null;
};

export type ProviderAttempt = {
  provider: ProviderId;
  key: string;
  keySource: ProviderKeySource;
  requestedCountry: CountryCode | null;
  resolvedCountry: CountryCode | null;
  countryParam: string | null;
  exactCountryApplied: boolean;
  providerSupportsCountry: boolean;
  countryResolution: CountryResolutionMode;
  reason: string;
};

export type ProviderRawResult = {
  title: string;
  url: string;
  snippet: string;
  display_url: string;
};

export type ProviderSearchResult = {
  ok: boolean;
  provider: ProviderId;
  status: number;
  results: ProviderRawResult[];
  details?: unknown;
};

// Coverage from provider location catalogs as audited on 2026-02-12.
// SerpAPI missing: AX, CU, IR, KP, SY.
const SERPAPI_UNSUPPORTED_COUNTRIES = new Set<CountryCode>(["AX", "CU", "IR", "KP", "SY"]);
// SearchApi.io missing: AX, BL, BQ, CW, MF, SS, SX.
const SEARCHAPI_UNSUPPORTED_COUNTRIES = new Set<CountryCode>(["AX", "BL", "BQ", "CW", "MF", "SS", "SX"]);

// Deterministic country proxies for unsupported regions.
// These are routing hints only; results remain raw upstream order.
const PROVIDER_PROXY_COUNTRY: Record<ProviderId, Partial<Record<CountryCode, CountryCode>>> = {
  serpapi: {
    AX: "FI",
    CU: "MX",
    IR: "TR",
    KP: "KR",
    SY: "TR",
  },
  searchapi: {
    AX: "FI",
    BL: "FR",
    BQ: "NL",
    CW: "NL",
    MF: "FR",
    SS: "SD",
    SX: "NL",
  },
  brave: {
    AX: "FI",
    BL: "FR",
    BQ: "NL",
    CW: "NL",
    MF: "FR",
    SS: "ZA",
    SX: "NL",
    CU: "MX",
    IR: "TR",
    KP: "KR",
    SY: "TR",
    UM: "US",
    EH: "ES",
  },
};

const EXACT_COUNTRY_PROVIDER_ORDER: readonly ProviderId[] = ["serpapi", "searchapi", "brave"];
const GLOBAL_PROVIDER_ORDER: readonly ProviderId[] = ["serpapi", "searchapi", "brave"];

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
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

function toRawResult(row: Record<string, unknown>): ProviderRawResult {
  const url =
    asString(row.url) ||
    asString(row.link) ||
    asString(row.destination) ||
    asString(row.redirect_link);
  const title = asString(row.title) || asString(row.name);
  const snippet = asString(row.description) || asString(row.snippet) || asString(row.content);
  const display_url =
    asString(row.display_url) ||
    asString(row.displayed_link) ||
    asString(row.display_link) ||
    deriveDisplayUrl(url);

  return { title, url, snippet, display_url };
}

function parseBraveResults(data: unknown): ProviderRawResult[] {
  const root = asRecord(data);
  const web = asRecord(root.web);
  const rows = Array.isArray(web.results)
    ? web.results
    : Array.isArray(root.results)
      ? root.results
      : [];

  return rows
    .map((r) => toRawResult(asRecord(r)))
    .filter((r) => Boolean(r.url));
}

function parseGoogleLikeResults(data: unknown): ProviderRawResult[] {
  const root = asRecord(data);
  const rows = Array.isArray(root.organic_results)
    ? root.organic_results
    : Array.isArray(root.results)
      ? root.results
      : Array.isArray(root.items)
        ? root.items
        : [];

  return rows
    .map((r) => toRawResult(asRecord(r)))
    .filter((r) => Boolean(r.url));
}

async function fetchJsonWithTimeout(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
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

function keyCandidatesForProvider(provider: ProviderId, keys: ProviderKeys): Array<{ key: string; keySource: ProviderKeySource }> {
  const user = keys.user[provider]?.trim() || "";
  const server = keys.server[provider]?.trim() || "";
  const out: Array<{ key: string; keySource: ProviderKeySource }> = [];

  if (user) out.push({ key: user, keySource: "user" });
  if (server) out.push({ key: server, keySource: "server" });

  return out;
}

function pushAttempt(
  out: ProviderAttempt[],
  provider: ProviderId,
  key: string,
  keySource: ProviderKeySource,
  requestedCountry: CountryCode | null,
  resolvedCountry: CountryCode | null,
  countryParam: string | null,
  exactCountryApplied: boolean,
  providerSupportsCountry: boolean,
  countryResolution: CountryResolutionMode,
  reason: string,
) {
  const signature = `${provider}|${keySource}|${requestedCountry ?? "none"}|${resolvedCountry ?? "none"}|${countryParam ?? "none"}|${countryResolution}`;
  if (out.some((a) => `${a.provider}|${a.keySource}|${a.requestedCountry ?? "none"}|${a.resolvedCountry ?? "none"}|${a.countryParam ?? "none"}|${a.countryResolution}` === signature)) {
    return;
  }

  out.push({
    provider,
    key,
    keySource,
    requestedCountry,
    resolvedCountry,
    countryParam,
    exactCountryApplied,
    providerSupportsCountry,
    countryResolution,
    reason,
  });
}

export function providerSupportsCountry(provider: ProviderId, country: CountryCode): boolean {
  switch (provider) {
    case "brave":
      return BRAVE_SUPPORTED_COUNTRIES.has(country as BraveSearchCountry);
    case "serpapi":
      return !SERPAPI_UNSUPPORTED_COUNTRIES.has(country);
    case "searchapi":
      return !SEARCHAPI_UNSUPPORTED_COUNTRIES.has(country);
  }
}

export function hasAnyExactCountrySupport(country: CountryCode): boolean {
  return (
    providerSupportsCountry("brave", country) ||
    providerSupportsCountry("serpapi", country) ||
    providerSupportsCountry("searchapi", country)
  );
}

function resolveProxyCountry(provider: ProviderId, country: CountryCode): CountryCode | null {
  const mapped = PROVIDER_PROXY_COUNTRY[provider][country];
  if (!mapped) return null;
  if (!providerSupportsCountry(provider, mapped)) return null;
  return mapped;
}

export function hasAnyTargetedCountrySupport(country: CountryCode): boolean {
  return (
    hasAnyExactCountrySupport(country) ||
    Boolean(resolveProxyCountry("brave", country)) ||
    Boolean(resolveProxyCountry("serpapi", country)) ||
    Boolean(resolveProxyCountry("searchapi", country))
  );
}

function toCountryParam(provider: ProviderId, country: CountryCode): string {
  return provider === "brave" ? country : country.toLowerCase();
}

export function resolveLanguagePlan(normalizedQuery: string, rawLangHint: string | null): SearchLanguagePlan {
  void normalizedQuery;
  void rawLangHint;
  // Strict reality mode: never send upstream language hints.
  return {
    langHint: null,
    searchLang: "none",
    searchLangSource: "provider_default",
    braveSearchLangParam: null,
    googleHlParam: null,
  };
}

export function buildProviderAttempts(countryHint: CountryCode | null, keys: ProviderKeys): ProviderAttempt[] {
  const attempts: ProviderAttempt[] = [];

  const addProviderAttempts = (
    provider: ProviderId,
    requestedCountry: CountryCode | null,
    resolvedCountry: CountryCode | null,
    countryParam: string | null,
    exactCountryApplied: boolean,
    providerSupports: boolean,
    countryResolution: CountryResolutionMode,
    reason: string,
  ) => {
    const keyCandidates = keyCandidatesForProvider(provider, keys);
    for (const keyCandidate of keyCandidates) {
      pushAttempt(
        attempts,
        provider,
        keyCandidate.key,
        keyCandidate.keySource,
        requestedCountry,
        resolvedCountry,
        countryParam,
        exactCountryApplied,
        providerSupports,
        countryResolution,
        reason,
      );
    }
  };

  if (countryHint) {
    for (const provider of EXACT_COUNTRY_PROVIDER_ORDER) {
      if (!providerSupportsCountry(provider, countryHint)) continue;

      const countryParam = toCountryParam(provider, countryHint);
      addProviderAttempts(
        provider,
        countryHint,
        countryHint,
        countryParam,
        true,
        true,
        "exact",
        "exact_country_match",
      );
    }

    for (const provider of EXACT_COUNTRY_PROVIDER_ORDER) {
      if (providerSupportsCountry(provider, countryHint)) continue;
      const proxyCountry = resolveProxyCountry(provider, countryHint);
      if (!proxyCountry) continue;
      const countryParam = toCountryParam(provider, proxyCountry);
      addProviderAttempts(
        provider,
        countryHint,
        proxyCountry,
        countryParam,
        false,
        false,
        "proxy",
        "proxy_country_match",
      );
    }

    for (const provider of GLOBAL_PROVIDER_ORDER) {
      const countryParam = provider === "brave" ? BRAVE_GLOBAL_COUNTRY : null;
      addProviderAttempts(
        provider,
        countryHint,
        null,
        countryParam,
        false,
        providerSupportsCountry(provider, countryHint),
        "global",
        "global_fallback",
      );
    }

    return attempts;
  }

  for (const provider of GLOBAL_PROVIDER_ORDER) {
    const countryParam = provider === "brave" ? BRAVE_GLOBAL_COUNTRY : null;
    addProviderAttempts(
      provider,
      null,
      null,
      countryParam,
      false,
      true,
      "global",
      "global_default",
    );
  }

  return attempts;
}

export function hasAnyProviderKey(keys: ProviderKeys): boolean {
  return (
    Object.values(keys.user).some((v) => Boolean(v && v.trim())) ||
    Object.values(keys.server).some((v) => Boolean(v && v.trim()))
  );
}

export function hasAnyUserProviderKey(keys: ProviderKeys): boolean {
  return Object.values(keys.user).some((v) => Boolean(v && v.trim()));
}

export async function executeProviderAttempt(
  attempt: ProviderAttempt,
  params: { q: string; languagePlan: SearchLanguagePlan },
): Promise<ProviderSearchResult> {
  if (attempt.provider === "brave") {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", params.q);
    url.searchParams.set("count", "20");
    url.searchParams.set("country", attempt.countryParam || BRAVE_GLOBAL_COUNTRY);

    const upstream = await fetchJsonWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        "X-Subscription-Token": attempt.key,
        Accept: "application/json",
      },
    });

    return {
      ok: upstream.ok,
      provider: "brave",
      status: upstream.status,
      results: upstream.ok ? parseBraveResults(upstream.data) : [],
      details: upstream.data,
    };
  }

  if (attempt.provider === "serpapi") {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", params.q);
    url.searchParams.set("num", "20");
    url.searchParams.set("api_key", attempt.key);
    if (attempt.countryParam) url.searchParams.set("gl", attempt.countryParam);

    const upstream = await fetchJsonWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    return {
      ok: upstream.ok,
      provider: "serpapi",
      status: upstream.status,
      results: upstream.ok ? parseGoogleLikeResults(upstream.data) : [],
      details: upstream.data,
    };
  }

  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", params.q);
  url.searchParams.set("num", "20");
  url.searchParams.set("api_key", attempt.key);
  if (attempt.countryParam) url.searchParams.set("gl", attempt.countryParam);

  const upstream = await fetchJsonWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${attempt.key}`,
    },
  });

  return {
    ok: upstream.ok,
    provider: "searchapi",
    status: upstream.status,
    results: upstream.ok ? parseGoogleLikeResults(upstream.data) : [],
    details: upstream.data,
  };
}

export function parseCountryHint(rawCountry: string | null): CountryCode | null {
  const countryUpper = rawCountry ? rawCountry.toUpperCase() : "";
  if (!countryUpper) return null;
  if (!(ISO_COUNTRY_CODES as readonly string[]).includes(countryUpper)) return null;
  return countryUpper as CountryCode;
}
