"use client";

import * as React from "react";

import { RealityPanel } from "@/components/RealityPanel";
import { ResultsList } from "@/components/ResultsList";
import { SearchForm, type SearchFormSubmit } from "@/components/SearchForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ErrorResponse, SearchResponse } from "@/lib/types";

export default function HomePage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [data, setData] = React.useState<SearchResponse | null>(null);

  const runSearch = React.useCallback(async ({ normalizedQuery, countryHint, userBraveKey }: SearchFormSubmit) => {
    setLoading(true);
    setError(null);

    try {
      const url = new URL("/api/search", window.location.origin);
      url.searchParams.set("q", normalizedQuery);
      if (countryHint) url.searchParams.set("country", countryHint);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: userBraveKey ? { "x-user-brave-key": userBraveKey } : undefined
      });

      const json = (await res.json().catch(() => null)) as SearchResponse | ErrorResponse | null;
      if (!res.ok) {
        const message = (json && "error" in json && typeof json.error === "string" ? json.error : null) ?? "Request failed.";
        const retryAfterRaw = res.headers.get("Retry-After");
        const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : NaN;
        setData(null);
        setError({
          status: res.status,
          message,
          ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {})
        });
        return;
      }

      setData(json as SearchResponse);
    } catch (e: any) {
      setData(null);
      setError({ status: 0, message: "Network error." });
    } finally {
      setLoading(false);
    }
  }, []);

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
                  <span className="text-muted-foreground">cache.mode:</span>{" "}
                  <span className="font-mono text-xs">{data.cache.mode}</span>
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
