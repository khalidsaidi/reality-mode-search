import type { RealityPanel } from "@/lib/reality";
import type { CountryResolutionMode } from "@/lib/countryResolution";

export type FetchedWith = "server_key" | "user_key" | "none";
export type CacheMode = "vercel-cdn" | "no-store";
export type ProviderId = "commoncrawl";
export type ProviderKeySource = "none";

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
    lang_hint: string | null;
    search_lang: string;
    search_lang_source: "explicit" | "provider_default" | "inferred_from_query" | "fallback_en";
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
    provider: ProviderId;
    providers_tried: string[];
    provider_key_source: ProviderKeySource;
    provider_route_reason: string;
    requested_country_supported_by_provider: boolean;
    exact_country_applied: boolean;
    country_resolution: CountryResolutionMode;
    resolved_country: string | null;
    applied_country_param: string | null;
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
