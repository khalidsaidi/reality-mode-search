export type RealityHistogramRow = {
  key: string;
  count: number;
  pct: number;
};

export type RealityPanel = {
  total_results: number;
  distinct_domains: number;
  distinct_tlds: number;
  distinct_countries_inferred: number;
  histograms: {
    tld: RealityHistogramRow[];
    country_inferred: RealityHistogramRow[];
    lang_detected: RealityHistogramRow[];
    top_domains: RealityHistogramRow[];
  };
};

type MinimalResult = {
  domain: string;
  tld: string;
  country_inferred: string;
  lang_detected: string;
};

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(((count / total) * 100) * 10) / 10;
}

function histogram(values: readonly string[], total: number): RealityHistogramRow[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, pct: pct(count, total) }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.key.localeCompare(b.key)));
}

export function computeRealityPanel(results: readonly MinimalResult[]): RealityPanel {
  const total = results.length;

  const domains = results.map((r) => r.domain).filter(Boolean);
  const tlds = results.map((r) => r.tld).filter(Boolean);
  const countries = results.map((r) => r.country_inferred).filter(Boolean);
  const langs = results.map((r) => r.lang_detected).filter(Boolean);

  const distinctDomains = new Set(domains);
  const distinctTlds = new Set(tlds);
  const distinctCountries = new Set(countries.filter((c) => c !== "unknown"));

  return {
    total_results: total,
    distinct_domains: distinctDomains.size,
    distinct_tlds: distinctTlds.size,
    distinct_countries_inferred: distinctCountries.size,
    histograms: {
      tld: histogram(tlds, total),
      country_inferred: histogram(countries, total),
      lang_detected: histogram(langs, total),
      top_domains: histogram(domains, total)
    }
  };
}

