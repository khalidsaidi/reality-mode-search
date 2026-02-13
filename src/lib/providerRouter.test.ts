import { describe, expect, it } from "vitest";

import { ISO_COUNTRIES } from "@/lib/isoCountries";
import {
  buildProviderAttempts,
  hasAnyExactCountrySupport,
  hasAnyTargetedCountrySupport,
  parseCountryHint,
  resolveLanguagePlan,
} from "@/lib/providerRouter";

describe("providerRouter", () => {
  it("tracks exact country support across provider union", () => {
    expect(hasAnyExactCountrySupport("FR")).toBe(true);
    expect(hasAnyExactCountrySupport("CU")).toBe(true);
    expect(hasAnyExactCountrySupport("AX")).toBe(false);
  });

  it("covers 248/249 countries with exact routes", () => {
    const covered = ISO_COUNTRIES.filter((c) => hasAnyExactCountrySupport(c.code)).length;
    expect(covered).toBe(248);
  });

  it("covers 249/249 countries with exact-or-proxy targeted routes", () => {
    const covered = ISO_COUNTRIES.filter((c) => hasAnyTargetedCountrySupport(c.code)).length;
    expect(covered).toBe(249);
  });

  it("builds exact-country attempts before fallbacks", () => {
    const attempts = buildProviderAttempts("FR", {
      user: {},
      server: {
        brave: "brave-server-key",
        serpapi: "serpapi-server-key",
        searchapi: "searchapi-server-key",
      },
    });

    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0]?.provider).toBe("serpapi");
    expect(attempts[0]?.exactCountryApplied).toBe(true);
    expect(attempts[0]?.countryParam).toBe("fr");

    const fallbackStart = attempts.findIndex((a) => a.reason === "global_fallback");
    expect(fallbackStart).toBeGreaterThan(0);
  });

  it("uses proxy-country attempts before global fallback when exact support is unavailable", () => {
    const attempts = buildProviderAttempts("AX", {
      user: {},
      server: {
        brave: "brave-server-key",
        serpapi: "serpapi-server-key",
        searchapi: "searchapi-server-key",
      },
    });

    expect(attempts.length).toBeGreaterThan(0);
    const proxyAttempts = attempts.filter((a) => a.reason === "proxy_country_match");
    expect(proxyAttempts.length).toBeGreaterThan(0);
    expect(proxyAttempts.some((a) => a.provider === "serpapi" && a.countryParam === "fi")).toBe(true);
    expect(proxyAttempts.some((a) => a.provider === "searchapi" && a.countryParam === "fi")).toBe(true);
    expect(proxyAttempts.some((a) => a.provider === "brave" && a.countryParam === "FI")).toBe(true);

    const fallbackStart = attempts.findIndex((a) => a.reason === "global_fallback");
    const proxyStart = attempts.findIndex((a) => a.reason === "proxy_country_match");
    expect(proxyStart).toBeGreaterThanOrEqual(0);
    expect(fallbackStart).toBeGreaterThan(proxyStart);
  });

  it("parses country hints safely", () => {
    expect(parseCountryHint("fr")).toBe("FR");
    expect(parseCountryHint("zz")).toBe(null);
    expect(parseCountryHint(null)).toBe(null);
  });

  it("disables upstream language hints in strict reality mode", () => {
    const auto = resolveLanguagePlan("pomme", "auto");
    expect(auto.langHint).toBe(null);
    expect(auto.searchLang).toBe("none");
    expect(auto.searchLangSource).toBe("provider_default");
    expect(auto.braveSearchLangParam).toBe(null);
    expect(auto.googleHlParam).toBe(null);
  });
});
