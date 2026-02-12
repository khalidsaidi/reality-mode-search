import { NextRequest, NextResponse } from "next/server";

import {
  BRAVE_SUPPORTED_COUNTRIES,
  inferBraveSearchLangFromFranc,
  isBraveSearchLang,
  type BraveSearchCountry,
  type BraveSearchLang
} from "@/lib/brave";
import { inferCountryFromTld } from "@/lib/countryInfer";
import { detectLang } from "@/lib/lang";
import { normalizeQuery } from "@/lib/normalize";
import { computeRealityPanel } from "@/lib/reality";
import { getDomain, getTld } from "@/lib/tld";
import type { CountryCode } from "@/lib/isoCountries";
import { ISO_COUNTRY_CODES } from "@/lib/isoCountries";
import type { SearchResult } from "@/lib/types";
import { dedupByCanonicalUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAVE_DEFAULT_SEARCH_LANG: BraveSearchLang = "en";

type SearchLangSource = "explicit" | "provider_default" | "inferred_from_query" | "fallback_en";

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
  lang_histogram: Array<{ key: string; count: number; pct: number }>;
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
    search_lang_source: SearchLangSource;
  };
  summary?: ProbeSummary;
  error?: string;
  details?: { upstream_status?: number };
};

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

function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return raw.toLowerCase() === "true";
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

async function braveSearch(params: {
  q: string;
  country: BraveSearchCountry;
  searchLang: BraveSearchLang | null;
  key: string;
}) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", params.q);
  url.searchParams.set("count", "20");
  url.searchParams.set("country", params.country);
  if (params.searchLang) url.searchParams.set("search_lang", params.searchLang);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Subscription-Token": params.key,
          Accept: "application/json"
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
  const reqUrl = new URL(req.url);
  const qRaw = reqUrl.searchParams.get("q") ?? "";
  const normalizedQ = normalizeQuery(qRaw);

  const countryRaw = reqUrl.searchParams.get("country") ?? "";
  const countryUpper = countryRaw.toUpperCase();
  const country =
    countryUpper && (ISO_COUNTRY_CODES as readonly string[]).includes(countryUpper)
      ? (countryUpper as CountryCode)
      : null;

  if (!normalizedQ) {
    const res = json({ error: "Missing required query parameter: q" }, { status: 400 });
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  if (!country) {
    const res = json({ error: "Missing or invalid required country code." }, { status: 400 });
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const enableByo = envBool("ENABLE_BYO_KEY", true);
  const userKey = enableByo ? (req.headers.get("x-user-brave-key") ?? "").trim() : "";
  if (!userKey) {
    const res = json(
      { error: "All-countries probe requires BYO key. Enable 'Use my own Brave key' and retry." },
      { status: 400 },
    );
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const langRaw = reqUrl.searchParams.get("lang") ?? "";
  const langLower = langRaw.trim().toLowerCase();

  let langHint: string | null = null;
  let upstreamSearchLangParam: BraveSearchLang | null = null;
  let effectiveSearchLang: BraveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
  let searchLangSource: SearchLangSource = "fallback_en";

  if (!langLower || langLower === "auto") {
    const queryLangFranc = detectLang(normalizedQ);
    const inferred = inferBraveSearchLangFromFranc(queryLangFranc);
    if (inferred) {
      upstreamSearchLangParam = inferred;
      effectiveSearchLang = inferred;
      searchLangSource = "inferred_from_query";
    } else {
      upstreamSearchLangParam = BRAVE_DEFAULT_SEARCH_LANG;
      effectiveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
      searchLangSource = "fallback_en";
    }
  } else if (langLower === "all" || langLower === "any" || langLower === "default") {
    langHint = "all";
    upstreamSearchLangParam = null;
    effectiveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
    searchLangSource = "provider_default";
  } else if (isBraveSearchLang(langLower)) {
    langHint = langLower;
    upstreamSearchLangParam = langLower;
    effectiveSearchLang = langLower;
    searchLangSource = "explicit";
  } else {
    const queryLangFranc = detectLang(normalizedQ);
    const inferred = inferBraveSearchLangFromFranc(queryLangFranc);
    if (inferred) {
      upstreamSearchLangParam = inferred;
      effectiveSearchLang = inferred;
      searchLangSource = "inferred_from_query";
    } else {
      upstreamSearchLangParam = BRAVE_DEFAULT_SEARCH_LANG;
      effectiveSearchLang = BRAVE_DEFAULT_SEARCH_LANG;
      searchLangSource = "fallback_en";
    }
  }

  const base: Omit<ProbeResponse, "status"> = {
    query: qRaw,
    normalized_query: normalizedQ,
    country,
    provider_supported: BRAVE_SUPPORTED_COUNTRIES.has(country),
    lens: {
      country_hint: country,
      lang_hint: langHint,
      search_lang: effectiveSearchLang,
      search_lang_source: searchLangSource
    }
  };

  if (!BRAVE_SUPPORTED_COUNTRIES.has(country)) {
    const res = json<ProbeResponse>({
      ...base,
      status: "unsupported",
      error: "Country hint is not supported by Brave provider for this endpoint."
    });
    setNoStore(res);
    setVaryUserKey(res);
    return res;
  }

  const upstream = await braveSearch({
    q: normalizedQ,
    country,
    searchLang: upstreamSearchLangParam,
    key: userKey
  });

  if (!upstream.ok) {
    const res = json<ProbeResponse>({
      ...base,
      status: "upstream_error",
      error: "Upstream probe failed.",
      details: { upstream_status: upstream.status }
    });
    setNoStore(res);
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
  const reality = computeRealityPanel(deduped);

  const summary: ProbeSummary = {
    returned: deduped.length,
    top_results: deduped.slice(0, 3).map((r) => ({
      title: r.title,
      url: r.url,
      domain: r.domain,
      tld: r.tld,
      country_inferred: r.country_inferred,
      lang_detected: r.lang_detected
    })),
    top_domains: reality.histograms.top_domains.slice(0, 3),
    lang_histogram: reality.histograms.lang_detected.slice(0, 5)
  };

  const res = json<ProbeResponse>({ ...base, status: "ok", summary });
  setNoStore(res);
  setVaryUserKey(res);
  return res;
}

