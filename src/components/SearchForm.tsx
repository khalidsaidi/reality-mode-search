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
  const [countryError, setCountryError] = React.useState(false);

  React.useEffect(() => {
    try {
      const savedCountry = localStorage.getItem("rms_country_hint");

      if (typeof savedCountry === "string") setCountry(savedCountry);
    } catch {
      // ignore
    }
  }, []);

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
            if (!country) {
              setCountryError(true);
              return;
            }
            onSubmit({
              normalizedQuery: normalized,
              countryHint: country
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
              Country (required)
            </label>
            <Select
              id="country"
              value={country}
              onChange={(e) => {
                setCountryError(false);
                setCountry(e.target.value);
              }}
            >
              <option value="">Select a country</option>
              {ISO_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Open-data mode targets country ccTLDs (with deterministic proxies for ISO entries without a ccTLD).
            </p>
            {countryError ? (
              <p className="text-xs text-destructive">Pick a country to run an open-data search.</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
