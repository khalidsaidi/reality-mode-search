import { describe, expect, it } from "vitest";

import { ISO_COUNTRIES } from "@/lib/isoCountries";
import { buildProviderAttempts, hasAnyExactCountrySupport, parseCountryHint, resolveLanguagePlan } from "@/lib/providerRouter";

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

  it("falls back to global routes when no provider supports exact country", () => {
    const attempts = buildProviderAttempts("AX", {
      user: {},
      server: {
        brave: "brave-server-key",
        serpapi: "serpapi-server-key",
        searchapi: "searchapi-server-key",
      },
    });

    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((a) => a.exactCountryApplied === false)).toBe(true);
    expect(attempts.every((a) => a.reason === "global_fallback")).toBe(true);
  });

  it("parses country hints safely", () => {
    expect(parseCountryHint("fr")).toBe("FR");
    expect(parseCountryHint("zz")).toBe(null);
    expect(parseCountryHint(null)).toBe(null);
  });

  it("resolves language plan for auto and all", () => {
    const auto = resolveLanguagePlan("pomme", "auto");
    expect(auto.searchLang).toBeTruthy();
    expect(["inferred_from_query", "fallback_en"]).toContain(auto.searchLangSource);

    const all = resolveLanguagePlan("pomme", "all");
    expect(all.langHint).toBe("all");
    expect(all.searchLangSource).toBe("provider_default");
  });
});
