"use client";

import * as React from "react";

import { RealityPanel } from "@/components/RealityPanel";
import { ResultsList } from "@/components/ResultsList";
import { SearchForm, type SearchFormSubmit } from "@/components/SearchForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toPlainTextFromHtml } from "@/lib/html";
import { ISO_COUNTRIES } from "@/lib/isoCountries";
import { resolveCountryTarget } from "@/lib/countryTargeting";
import type { ErrorResponse, SearchResponse } from "@/lib/types";

const GLOBAL_COMPARE_BUCKETS = [
  { id: "fr", label: "France (FR)", countryHint: "FR" },
  { id: "in", label: "India (IN)", countryHint: "IN" },
  { id: "br", label: "Brazil (BR)", countryHint: "BR" },
  { id: "jp", label: "Japan (JP)", countryHint: "JP" },
  { id: "us", label: "United States (US)", countryHint: "US" },
] as const;

type GlobalCompareBucket = (typeof GLOBAL_COMPARE_BUCKETS)[number];

type SearchState =
  | { ok: true; data: SearchResponse }
  | {
      ok: false;
      status: number;
      message: string;
      retryAfterSeconds?: number;
    };

type GlobalCompareResult = {
  bucket: GlobalCompareBucket;
  state: SearchState;
};

type ProbeCountryResponse = {
  country: string;
  provider_supported: boolean;
  status: "ok" | "unsupported" | "upstream_error";
  summary?: {
    top_results: Array<{ title: string }>;
    top_domains: Array<{ key: string }>;
  };
  routing?: {
    selected_provider?: string;
    selected_key_source?: "none";
    exact_country_applied?: boolean;
    country_resolution?: "exact" | "proxy" | "global";
    resolved_country?: string | null;
    route_reason?: string;
  };
  error?: string;
};

type CountrySweepRow = {
  code: string;
  name: string;
  providerSupported: boolean;
  status: "pending" | "ok" | "unsupported" | "upstream_error" | "error";
  topDomain?: string;
  topResultTitle?: string;
  message?: string;
};

const COUNTRY_SWEEP_DELAY_MS = 1200;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function HomePage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [lastSubmit, setLastSubmit] = React.useState<SearchFormSubmit | null>(null);
  const [compareLoading, setCompareLoading] = React.useState(false);
  const [compareResults, setCompareResults] = React.useState<GlobalCompareResult[] | null>(null);
  const [sweepRunning, setSweepRunning] = React.useState(false);
  const [sweepError, setSweepError] = React.useState<string | null>(null);
  const [sweepRows, setSweepRows] = React.useState<CountrySweepRow[] | null>(null);
  const [sweepProgress, setSweepProgress] = React.useState<{
    completed: number;
    total: number;
    supportedCompleted: number;
    supportedTotal: number;
  } | null>(null);
  const sweepStopRequestedRef = React.useRef(false);

  const fetchSearch = React.useCallback(async (params: SearchFormSubmit): Promise<SearchState> => {
    try {
      const url = new URL("/api/search", window.location.origin);
      url.searchParams.set("q", params.normalizedQuery);
      if (params.countryHint) url.searchParams.set("country", params.countryHint);

      const res = await fetch(url.toString(), {
        method: "GET"
      });

      const json = (await res.json().catch(() => null)) as SearchResponse | ErrorResponse | null;
      if (!res.ok) {
        const message = (json && "error" in json && typeof json.error === "string" ? json.error : null) ?? "Request failed.";
        const retryAfterRaw = res.headers.get("Retry-After");
        const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : NaN;

        return {
          ok: false,
          status: res.status,
          message,
          ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {})
        };
      }

      return { ok: true, data: json as SearchResponse };
    } catch {
      return { ok: false, status: 0, message: "Network error." };
    }
  }, []);

  const runSearch = React.useCallback(
    async (params: SearchFormSubmit) => {
      setLoading(true);
      setError(null);
      setLastSubmit(params);
      setCompareResults(null);
      setSweepRows(null);
      setSweepProgress(null);
      setSweepError(null);
      sweepStopRequestedRef.current = false;

      const result = await fetchSearch(params);
      if (!result.ok) {
        setData(null);
        setError({
          status: result.status,
          message: result.message,
          ...(typeof result.retryAfterSeconds === "number" ? { retryAfterSeconds: result.retryAfterSeconds } : {})
        });
        setLoading(false);
        return;
      }

      setData(result.data);
      setLoading(false);
    },
    [fetchSearch],
  );

  const runGlobalCompare = React.useCallback(async () => {
    if (!lastSubmit) return;

    setCompareLoading(true);
    setCompareResults(null);

    const results = await Promise.all(
      GLOBAL_COMPARE_BUCKETS.map(async (bucket) => {
        const state = await fetchSearch({
          normalizedQuery: lastSubmit.normalizedQuery,
          countryHint: bucket.countryHint
        });
        return { bucket, state } satisfies GlobalCompareResult;
      }),
    );

    setCompareResults(results);
    setCompareLoading(false);
  }, [fetchSearch, lastSubmit]);

  const runAllCountriesSweep = React.useCallback(async () => {
    if (!lastSubmit) return;

    setSweepRunning(true);
    setSweepError(null);
    sweepStopRequestedRef.current = false;

    const rows: CountrySweepRow[] = ISO_COUNTRIES.map((country) => {
      // Country targets are deterministic for all ISO entries (with proxies for missing ccTLDs).
      void resolveCountryTarget(country.code);
      const supported = true;
      return {
        code: country.code,
        name: country.name,
        providerSupported: supported,
        status: "pending",
        message: supported ? undefined : "No country-targeting route support. Will use global fallback if available."
      };
    });
    setSweepRows(rows);

    const supportedCountries = rows.filter((r) => r.providerSupported).map((r) => r.code);
    let completed = 0;
    let supportedCompleted = 0;
    setSweepProgress({
      completed,
      total: rows.length,
      supportedCompleted,
      supportedTotal: supportedCountries.length
    });

    const rowIndexByCode = new Map(rows.map((r, idx) => [r.code, idx]));

    for (const country of ISO_COUNTRIES) {
      if (sweepStopRequestedRef.current) break;

      const rowIdx = rowIndexByCode.get(country.code);
      if (rowIdx == null) continue;

      if (!rows[rowIdx].providerSupported) {
        rows[rowIdx] = {
          ...rows[rowIdx],
          status: "pending",
          message: "No country-targeting route support. Trying global fallback route."
        };
      }

      try {
        const url = new URL("/api/compare-country", window.location.origin);
        url.searchParams.set("q", lastSubmit.normalizedQuery);
        url.searchParams.set("country", country.code);

        const res = await fetch(url.toString(), {
          method: "GET"
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as ErrorResponse | null;
          rows[rowIdx] = {
            ...rows[rowIdx],
            status: "error",
            message: err?.error ?? `HTTP ${res.status}`
          };
        } else {
          const body = (await res.json().catch(() => null)) as ProbeCountryResponse | null;
          if (!body) {
            rows[rowIdx] = {
              ...rows[rowIdx],
              status: "error",
              message: "Invalid response."
            };
          } else if (body.status === "ok") {
            rows[rowIdx] = {
              ...rows[rowIdx],
              status: "ok",
              topDomain: body.summary?.top_domains?.[0]?.key,
              topResultTitle: body.summary?.top_results?.[0]?.title,
              message: body.routing?.selected_provider
                ? `${body.routing.selected_provider} (${body.routing.country_resolution ?? (body.routing.exact_country_applied ? "exact" : "fallback")}${body.routing.resolved_country ? `:${body.routing.resolved_country}` : ""})`
                : undefined
            };
          } else {
            rows[rowIdx] = {
              ...rows[rowIdx],
              status: body.status,
              message: body.error ?? undefined
            };
          }
        }
      } catch {
        rows[rowIdx] = {
          ...rows[rowIdx],
          status: "error",
          message: "Network error."
        };
      }

      completed += 1;
      if (rows[rowIdx].providerSupported) supportedCompleted += 1;
      setSweepRows([...rows]);
      setSweepProgress({
        completed,
        total: rows.length,
        supportedCompleted,
        supportedTotal: supportedCountries.length
      });

      // Be gentle to the public index server.
      await delay(COUNTRY_SWEEP_DELAY_MS);
    }

    if (sweepStopRequestedRef.current) {
      setSweepError("Sweep stopped.");
    }
    setSweepRunning(false);
  }, [lastSubmit]);

  const stopAllCountriesSweep = React.useCallback(() => {
    sweepStopRequestedRef.current = true;
  }, []);

  const compareById = React.useMemo(() => {
    return new Map((compareResults ?? []).map((r) => [r.bucket.id, r]));
  }, [compareResults]);

  return (
    <main className="min-h-screen bg-[radial-gradient(60rem_60rem_at_30%_-10%,hsl(var(--primary)/0.18),transparent_60%),radial-gradient(40rem_40rem_at_90%_20%,hsl(var(--ring)/0.12),transparent_55%)]">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10">
        <header className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Reality Mode Search</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Results are shown in upstream order. The only allowed modification is URL canonicalization + stable dedup
            (keep first occurrence).
          </p>
        </header>

        <SearchForm loading={loading} onSubmit={runSearch} />

        {error ? (
          <Alert>
            <AlertTitle>
              {error.status === 429 ? "Rate limited" : error.status === 503 ? "Upstream paused/throttled" : "Error"}
            </AlertTitle>
            <AlertDescription className="grid gap-2">
              <div>{error.message}</div>
              {error.status === 429 ? (
                <div>
                  Retry after {typeof error.retryAfterSeconds === "number" ? `${error.retryAfterSeconds}s` : "a bit"}.
                </div>
              ) : null}
              {error.status === 503 ? (
                <div>Tip: the upstream index can be temporarily unavailable. Try again later.</div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {data ? (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Request</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">normalized_query:</span>{" "}
                  <span className="font-mono text-xs">{data.normalized_query}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">country_hint:</span>{" "}
                  <span className="font-mono text-xs">{data.lens.country_hint ?? "null"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">cache.mode:</span>{" "}
                  <span className="font-mono text-xs">{data.cache.mode}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">provider:</span>{" "}
                  <span className="font-mono text-xs">
                    {data.meta.provider} ({data.meta.provider_key_source}, {data.meta.country_resolution}
                    {data.meta.resolved_country ? `:${data.meta.resolved_country}` : ""})
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
                <div className="grid gap-1">
                  <CardTitle>Global Compare</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Same query across multiple country hints. No re-ranking; each card is raw upstream order after
                    dedup.
                  </p>
                </div>
                <Button onClick={runGlobalCompare} disabled={compareLoading || !lastSubmit}>
                  {compareLoading ? "Comparing..." : "Run Compare"}
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-xs text-muted-foreground">
                  Runs {GLOBAL_COMPARE_BUCKETS.length} searches, so rate limits can trigger faster.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {GLOBAL_COMPARE_BUCKETS.map((bucket) => {
                    const entry = compareById.get(bucket.id);
                    return (
                      <div key={bucket.id} className="grid gap-2 rounded-lg border p-3">
                        <div className="text-sm font-medium">{bucket.label}</div>
                        {!entry ? (
                          <div className="text-xs text-muted-foreground">
                            {compareLoading ? "Loading..." : "Not run yet."}
                          </div>
                        ) : entry.state.ok ? (
                          <>
                            <div className="grid gap-1">
                              {entry.state.data.results.slice(0, 3).map((r, i) => (
                                <a
                                  key={`${bucket.id}-${r.url}-${i}`}
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate text-xs underline decoration-transparent underline-offset-4 hover:decoration-current"
                                >
                                  {toPlainTextFromHtml(r.title || r.url)}
                                </a>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-destructive">
                            {entry.state.status}: {entry.state.message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
                <div className="grid gap-1">
                  <CardTitle>All Countries Sweep (249)</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Tests every ISO country via ccTLD targeting (with deterministic proxies for ISO entries without a
                  delegated ccTLD).
                </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={runAllCountriesSweep} disabled={sweepRunning || !lastSubmit}>
                    {sweepRunning ? "Running..." : "Run ALL Countries"}
                  </Button>
                  {sweepRunning ? (
                    <Button variant="secondary" onClick={stopAllCountriesSweep}>
                      Stop
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-xs text-muted-foreground">
                  Sweep runs sequentially with delay to avoid overloading the public index server.
                </p>

                {sweepProgress ? (
                  <div className="text-xs text-muted-foreground">
                    Progress: {sweepProgress.completed}/{sweepProgress.total} countries, supported probes:{" "}
                    {sweepProgress.supportedCompleted}/{sweepProgress.supportedTotal}.
                  </div>
                ) : null}

                {sweepError ? <div className="text-xs text-destructive">{sweepError}</div> : null}

                <div className="overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead>Supported</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Top Domain</TableHead>
                        <TableHead>Top Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(sweepRows ?? []).map((row) => (
                        <TableRow key={row.code}>
                          <TableCell className="font-mono text-xs">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.providerSupported ? "yes" : "no"}</TableCell>
                          <TableCell>{row.status}</TableCell>
                          <TableCell className="font-mono text-xs">{row.topDomain ?? "-"}</TableCell>
                          <TableCell className="max-w-[22rem] truncate text-xs" title={row.topResultTitle ?? row.message}>
                            {row.topResultTitle ?? row.message ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <RealityPanel reality={data.reality} />
            <ResultsList results={data.results} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
