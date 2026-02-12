import { NextRequest, NextResponse } from "next/server";

import { inferCountryFromTld } from "@/lib/countryInfer";
import { detectLang } from "@/lib/lang";
import { normalizeQuery } from "@/lib/normalize";
import {
  buildProviderAttempts,
  executeProviderAttempt,
  hasAnyExactCountrySupport,
  hasAnyProviderKey,
  parseCountryHint,
  resolveLanguagePlan,
  type SearchLangSource,
} from "@/lib/providerRouter";
import { computeRealityPanel } from "@/lib/reality";
import { getDomain, getTld } from "@/lib/tld";
import type { CountryCode } from "@/lib/isoCountries";
import type { SearchResult } from "@/lib/types";
import { dedupByCanonicalUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  routing: {
    selected_provider?: string;
    selected_key_source?: "user" | "server";
    exact_country_applied?: boolean;
    route_reason?: string;
    attempts: Array<{
      provider: string;
      status: number;
      key_source: "user" | "server";
      reason: string;
      exact_country_applied: boolean;
    }>;
  };
  summary?: ProbeSummary;
  error?: string;
};

function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return raw.toLowerCase() === "true";
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

export async function GET(req: NextRequest) {
  const reqUrl = new URL(req.url);
  const qRaw = reqUrl.searchParams.get("q") ?? "";
  const normalizedQ = normalizeQuery(qRaw);
  const country = parseCountryHint(reqUrl.searchParams.get("country"));

  if (!normalizedQ) {
    const res = json({ error: "Missing required query parameter: q" }, { status: 400 });
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  if (!country) {
    const res = json({ error: "Missing or invalid required country code." }, { status: 400 });
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

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

  const providerSupported = hasAnyExactCountrySupport(country);
  const attempts = buildProviderAttempts(country, keys);

  const base: Omit<ProbeResponse, "status"> = {
    query: qRaw,
    normalized_query: normalizedQ,
    country,
    provider_supported: providerSupported,
    lens: {
      country_hint: country,
      lang_hint: languagePlan.langHint,
      search_lang: languagePlan.searchLang,
      search_lang_source: languagePlan.searchLangSource,
    },
    routing: {
      attempts: [],
    },
  };

  if (!hasAnyProviderKey(keys)) {
    const res = json<ProbeResponse>(
      {
        ...base,
        status: "upstream_error",
        error:
          "No provider key configured. Add BRAVE_API_KEY, SERPAPI_API_KEY, SEARCHAPI_API_KEY, or send x-user-* headers.",
      },
      { status: 503 },
    );
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  if (attempts.length === 0) {
    const res = json<ProbeResponse>(
      {
        ...base,
        status: providerSupported ? "upstream_error" : "unsupported",
        error: providerSupported
          ? "No provider route available with configured keys."
          : "No exact provider support for this country and no fallback route is configured.",
      },
      { status: providerSupported ? 503 : 200 },
    );
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  let selected:
    | {
        attempt: (typeof attempts)[number];
        mapped: SearchResult[];
      }
    | null = null;

  for (const attempt of attempts) {
    const upstream = await executeProviderAttempt(attempt, {
      q: normalizedQ,
      languagePlan,
    });

    base.routing.attempts.push({
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

    selected = { attempt, mapped };
    break;
  }

  if (!selected) {
    const res = json<ProbeResponse>(
      {
        ...base,
        status: providerSupported ? "upstream_error" : "unsupported",
        error: providerSupported
          ? "Upstream probe failed across all provider routes."
          : "Country has no exact support in configured providers, and fallback routes failed.",
      },
      { status: providerSupported ? 503 : 200 },
    );
    setNoStore(res);
    setVaryUserKeys(res);
    return res;
  }

  const deduped = dedupByCanonicalUrl(selected.mapped);
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
    lang_histogram: reality.histograms.lang_detected.slice(0, 5),
  };

  const res = json<ProbeResponse>({
    ...base,
    status: "ok",
    routing: {
      ...base.routing,
      selected_provider: selected.attempt.provider,
      selected_key_source: selected.attempt.keySource,
      exact_country_applied: selected.attempt.exactCountryApplied,
      route_reason: selected.attempt.reason,
    },
    summary,
  });
  setNoStore(res);
  setVaryUserKeys(res);
  return res;
}
