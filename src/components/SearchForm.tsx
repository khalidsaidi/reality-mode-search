"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { normalizeQuery } from "@/lib/normalize";
import { ISO_COUNTRIES } from "@/lib/isoCountries";

export type SearchFormSubmit = {
  normalizedQuery: string;
  countryHint: string | null;
  userBraveKey: string | null;
  userSerpApiKey: string | null;
  userSearchApiKey: string | null;
};

export function SearchForm({
  loading,
  onSubmit
}: {
  loading: boolean;
  onSubmit: (args: SearchFormSubmit) => void;
}) {
  const [q, setQ] = React.useState("");
  const [country, setCountry] = React.useState<string>("");

  const [useByo, setUseByo] = React.useState(false);
  const [byoBraveKey, setByoBraveKey] = React.useState("");
  const [byoSerpApiKey, setByoSerpApiKey] = React.useState("");
  const [byoSearchApiKey, setByoSearchApiKey] = React.useState("");

  React.useEffect(() => {
    try {
      const savedUseByo = localStorage.getItem("rms_use_byo");
      const savedBraveKey = localStorage.getItem("rms_byo_brave_key");
      const savedSerpApiKey = localStorage.getItem("rms_byo_serpapi_key");
      const savedSearchApiKey = localStorage.getItem("rms_byo_searchapi_key");
      const savedCountry = localStorage.getItem("rms_country_hint");

      if (savedUseByo === "true") setUseByo(true);
      if (typeof savedBraveKey === "string") setByoBraveKey(savedBraveKey);
      if (typeof savedSerpApiKey === "string") setByoSerpApiKey(savedSerpApiKey);
      if (typeof savedSearchApiKey === "string") setByoSearchApiKey(savedSearchApiKey);
      if (typeof savedCountry === "string") setCountry(savedCountry);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem("rms_use_byo", String(useByo));
    } catch {
      // ignore
    }
  }, [useByo]);

  React.useEffect(() => {
    try {
      localStorage.setItem("rms_byo_brave_key", byoBraveKey);
    } catch {
      // ignore
    }
  }, [byoBraveKey]);

  React.useEffect(() => {
    try {
      localStorage.setItem("rms_byo_serpapi_key", byoSerpApiKey);
    } catch {
      // ignore
    }
  }, [byoSerpApiKey]);

  React.useEffect(() => {
    try {
      localStorage.setItem("rms_byo_searchapi_key", byoSearchApiKey);
    } catch {
      // ignore
    }
  }, [byoSearchApiKey]);

  React.useEffect(() => {
    try {
      localStorage.setItem("rms_country_hint", country);
    } catch {
      // ignore
    }
  }, [country]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const normalized = normalizeQuery(q);
            if (!normalized) return;
            onSubmit({
              normalizedQuery: normalized,
              countryHint: country ? country : null,
              userBraveKey: useByo ? (byoBraveKey.trim() || null) : null,
              userSerpApiKey: useByo ? (byoSerpApiKey.trim() || null) : null,
              userSearchApiKey: useByo ? (byoSearchApiKey.trim() || null) : null
            });
          }}
        >
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="q">
              Query
            </label>
            <div className="flex gap-2">
              <Input
                id="q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search the open web..."
                autoComplete="off"
              />
              <Button type="submit" disabled={loading}>
                {loading ? "Searching..." : "Search"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Query is normalized (trim, collapse whitespace, lowercase) before request to maximize CDN cache hits.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="country">
              Country hint (optional)
            </label>
            <Select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Worldwide (no hint)</option>
              {ISO_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              This is exploration only. Results are not re-ranked or filtered.
            </p>
          </div>

          <div className="grid gap-2 rounded-xl border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={useByo}
                onChange={(e) => setUseByo(e.target.checked)}
              />
              Use my own provider keys
            </label>

            {useByo ? (
              <div className="grid gap-2">
                <Input
                  value={byoBraveKey}
                  onChange={(e) => setByoBraveKey(e.target.value)}
                  placeholder="Brave Search API key (optional)"
                  autoComplete="off"
                />
                <Input
                  value={byoSerpApiKey}
                  onChange={(e) => setByoSerpApiKey(e.target.value)}
                  placeholder="SerpAPI key (optional)"
                  autoComplete="off"
                />
                <Input
                  value={byoSearchApiKey}
                  onChange={(e) => setByoSearchApiKey(e.target.value)}
                  placeholder="SearchApi key (optional)"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  BYO key requests are private (not cached) and may be slower. Keys stay in your browser.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Server-key requests are cached at the Vercel CDN to stay sustainable.
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
