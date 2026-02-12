"use client";

import * as React from "react";

import { RealityPanel } from "@/components/RealityPanel";
import { ResultsList } from "@/components/ResultsList";
import { SearchForm, type SearchFormSubmit } from "@/components/SearchForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toPlainTextFromHtml } from "@/lib/html";
import type { ErrorResponse, SearchResponse } from "@/lib/types";

const GLOBAL_COMPARE_BUCKETS = [
  { id: "all", label: "Worldwide (ALL)", countryHint: null },
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

  const fetchSearch = React.useCallback(async (params: SearchFormSubmit): Promise<SearchState> => {
    try {
      const url = new URL("/api/search", window.location.origin);
      url.searchParams.set("q", params.normalizedQuery);
      if (params.countryHint) url.searchParams.set("country", params.countryHint);
      if (params.langHint) url.searchParams.set("lang", params.langHint);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: params.userBraveKey ? { "x-user-brave-key": params.userBraveKey } : undefined
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
          countryHint: bucket.countryHint,
          langHint: lastSubmit.langHint,
          userBraveKey: lastSubmit.userBraveKey
        });
        return { bucket, state } satisfies GlobalCompareResult;
      }),
    );

    setCompareResults(results);
    setCompareLoading(false);
  }, [fetchSearch, lastSubmit]);

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
                <div>Tip: enable “Use my own Brave key” to bypass shared budget/caching.</div>
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
                  <span className="text-muted-foreground">lang_hint:</span>{" "}
                  <span className="font-mono text-xs">{data.lens.lang_hint ?? "null"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">search_lang:</span>{" "}
                  <span className="font-mono text-xs">
                    {data.lens.search_lang} ({data.lens.search_lang_source})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">cache.mode:</span>{" "}
                  <span className="font-mono text-xs">{data.cache.mode}</span>
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
                            <div className="text-xs text-muted-foreground">
                              search_lang:{" "}
                              <span className="font-mono">
                                {entry.state.data.lens.search_lang} ({entry.state.data.lens.search_lang_source})
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              lang breakdown:{" "}
                              <span className="font-mono">
                                {entry.state.data.reality.histograms.lang_detected
                                  .slice(0, 3)
                                  .map((h) => `${h.key}:${h.pct.toFixed(1)}%`)
                                  .join(" | ")}
                              </span>
                            </div>
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

            <RealityPanel reality={data.reality} />
            <ResultsList results={data.results} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
