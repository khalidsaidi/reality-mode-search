import type { RealityPanel } from "@/lib/reality";

export type FetchedWith = "server_key" | "user_key" | "none";
export type CacheMode = "vercel-cdn" | "no-store";

export type SearchResult = {
  title: string;
  url: string;
  display_url: string;
  snippet: string;
  domain: string;
  tld: string;
  country_inferred: string;
  lang_detected: string;
};

export type SearchResponse = {
  query: string;
  normalized_query: string;
  lens: {
    mode: "reality";
    country_hint: string | null;
    search_lang: string;
    search_lang_source: "inferred_from_query" | "fallback_en";
  };
  results: SearchResult[];
  reality: RealityPanel;
  cache: {
    mode: CacheMode;
    ttl_seconds: number;
    swr_seconds: number;
    stale_if_error_seconds: number;
  };
  meta: {
    provider: "brave";
    fetched_with: FetchedWith;
    deduped: number;
    returned: number;
    build: { sha: string };
  };
};

export type ErrorResponse = {
  error: string;
  details?: unknown;
};
