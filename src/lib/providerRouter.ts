import {
  BRAVE_GLOBAL_COUNTRY,
  BRAVE_SUPPORTED_COUNTRIES,
  inferBraveSearchLangFromFranc,
  isBraveSearchLang,
  type BraveSearchCountry,
  type BraveSearchLang,
} from "@/lib/brave";
import { detectLang } from "@/lib/lang";
import type { CountryCode } from "@/lib/isoCountries";
import { ISO_COUNTRY_CODES } from "@/lib/isoCountries";

export type ProviderId = "brave" | "serpapi" | "searchapi";
export type ProviderKeySource = "user" | "server";
export type SearchLangSource = "explicit" | "provider_default" | "inferred_from_query" | "fallback_en";

export type ProviderKeys = {
  user: Partial<Record<ProviderId, string>>;
  server: Partial<Record<ProviderId, string>>;
};

export type SearchLanguagePlan = {
  langHint: string | null;
  searchLang: string;
  searchLangSource: SearchLangSource;
  braveSearchLangParam: BraveSearchLang | null;
  googleHlParam: string | null;
};

export type ProviderAttempt = {
  provider: ProviderId;
  key: string;
  keySource: ProviderKeySource;
  requestedCountry: CountryCode | null;
  countryParam: string | null;
  exactCountryApplied: boolean;
  providerSupportsCountry: boolean;
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

const BRAVE_DEFAULT_SEARCH_LANG: BraveSearchLang = "en";

const BRAVE_TO_GOOGLE_HL: Record<BraveSearchLang, string> = {
  ar: "ar",
  eu: "eu",
  bn: "bn",
  bg: "bg",
  ca: "ca",
  "zh-hans": "zh-CN",
  "zh-hant": "zh-TW",
  hr: "hr",
  cs: "cs",
  da: "da",
  nl: "nl",
  en: "en",
  "en-gb": "en-GB",
  et: "et",
  fi: "fi",
  fr: "fr",
  gl: "gl",
  de: "de",
  el: "el",
  gu: "gu",
  he: "iw",
  hi: "hi",
  hu: "hu",
  is: "is",
  it: "it",
  jp: "ja",
  kn: "kn",
  ko: "ko",
  lv: "lv",
  lt: "lt",
  ms: "ms",
  ml: "ml",
  mr: "mr",
  nb: "no",
  pl: "pl",
  "pt-br": "pt-BR",
  "pt-pt": "pt-PT",
  pa: "pa",
  ro: "ro",
  ru: "ru",
  sr: "sr",
  sk: "sk",
  sl: "sl",
  es: "es",
  sv: "sv",
  ta: "ta",
  te: "te",
  th: "th",
  tr: "tr",
  uk: "uk",
  vi: "vi",
};

// Coverage from provider location catalogs as audited on 2026-02-12.
// SerpAPI missing: AX, CU, IR, KP, SY.
const SERPAPI_UNSUPPORTED_COUNTRIES = new Set<CountryCode>(["AX", "CU", "IR", "KP", "SY"]);
// SearchApi.io missing: AX, BL, BQ, CW, MF, SS, SX.
const SEARCHAPI_UNSUPPORTED_COUNTRIES = new Set<CountryCode>(["AX", "BL", "BQ", "CW", "MF", "SS", "SX"]);

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
  countryParam: string | null,
  exactCountryApplied: boolean,
  providerSupportsCountry: boolean,
  reason: string,
) {
  const signature = `${provider}|${keySource}|${requestedCountry ?? "none"}|${countryParam ?? "none"}|${exactCountryApplied ? 1 : 0}`;
  if (out.some((a) => `${a.provider}|${a.keySource}|${a.requestedCountry ?? "none"}|${a.countryParam ?? "none"}|${a.exactCountryApplied ? 1 : 0}` === signature)) {
    return;
  }

  out.push({
    provider,
    key,
    keySource,
    requestedCountry,
    countryParam,
    exactCountryApplied,
    providerSupportsCountry,
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

export function resolveLanguagePlan(normalizedQuery: string, rawLangHint: string | null): SearchLanguagePlan {
  const langLower = (rawLangHint ?? "").trim().toLowerCase();

  let langHint: string | null = null;
  let braveSearchLangParam: BraveSearchLang | null = null;
  let effectiveSearchLang: BraveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
  let searchLangSource: SearchLangSource = "fallback_en";

  if (!langLower || langLower === "auto") {
    const queryLangFranc = detectLang(normalizedQuery);
    const inferred = inferBraveSearchLangFromFranc(queryLangFranc);
    if (inferred) {
      braveSearchLangParam = inferred;
      effectiveSearchLang = inferred;
      searchLangSource = "inferred_from_query";
    } else {
      braveSearchLangParam = BRAVE_DEFAULT_SEARCH_LANG;
      effectiveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
      searchLangSource = "fallback_en";
    }
  } else if (langLower === "all" || langLower === "any" || langLower === "default") {
    langHint = "all";
    braveSearchLangParam = null;
    effectiveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
    searchLangSource = "provider_default";
  } else if (isBraveSearchLang(langLower)) {
    langHint = langLower;
    braveSearchLangParam = langLower;
    effectiveSearchLang = langLower;
    searchLangSource = "explicit";
  } else {
    const queryLangFranc = detectLang(normalizedQuery);
    const inferred = inferBraveSearchLangFromFranc(queryLangFranc);
    if (inferred) {
      braveSearchLangParam = inferred;
      effectiveSearchLang = inferred;
      searchLangSource = "inferred_from_query";
    } else {
      braveSearchLangParam = BRAVE_DEFAULT_SEARCH_LANG;
      effectiveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
      searchLangSource = "fallback_en";
    }
  }

  return {
    langHint,
    searchLang: effectiveSearchLang,
    searchLangSource,
    braveSearchLangParam,
    googleHlParam: BRAVE_TO_GOOGLE_HL[effectiveSearchLang],
  };
}

export function buildProviderAttempts(countryHint: CountryCode | null, keys: ProviderKeys): ProviderAttempt[] {
  const attempts: ProviderAttempt[] = [];

  const addProviderAttempts = (
    provider: ProviderId,
    requestedCountry: CountryCode | null,
    countryParam: string | null,
    exactCountryApplied: boolean,
    providerSupports: boolean,
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
        countryParam,
        exactCountryApplied,
        providerSupports,
        reason,
      );
    }
  };

  if (countryHint) {
    for (const provider of EXACT_COUNTRY_PROVIDER_ORDER) {
      if (!providerSupportsCountry(provider, countryHint)) continue;

      const countryParam = provider === "brave" ? countryHint : countryHint.toLowerCase();
      addProviderAttempts(
        provider,
        countryHint,
        countryParam,
        true,
        true,
        "exact_country_match",
      );
    }

    for (const provider of GLOBAL_PROVIDER_ORDER) {
      const countryParam = provider === "brave" ? BRAVE_GLOBAL_COUNTRY : null;
      addProviderAttempts(
        provider,
        countryHint,
        countryParam,
        false,
        providerSupportsCountry(provider, countryHint),
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
      countryParam,
      false,
      true,
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
    if (params.languagePlan.braveSearchLangParam) {
      url.searchParams.set("search_lang", params.languagePlan.braveSearchLangParam);
    }

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
    if (params.languagePlan.googleHlParam) url.searchParams.set("hl", params.languagePlan.googleHlParam);

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
  if (params.languagePlan.googleHlParam) url.searchParams.set("hl", params.languagePlan.googleHlParam);

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
