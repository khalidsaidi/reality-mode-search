import { describe, expect, it } from "vitest";

import { ISO_COUNTRIES } from "@/lib/isoCountries";
import { resolveCountryTarget } from "@/lib/countryTargeting";

describe("countryTargeting", () => {
  it("resolves a TLD target for all 249 ISO countries", () => {
    const targets = ISO_COUNTRIES.map((c) => resolveCountryTarget(c.code));
    expect(targets).toHaveLength(249);
    for (const t of targets) {
      expect(t.tld).toBeTypeOf("string");
      expect(t.tld.length).toBeGreaterThan(0);
      expect(t.tld).toBe(t.tld.toLowerCase());
      expect(t.tld.includes(".")).toBe(false);
    }
  });

  it("uses deterministic proxies for missing ccTLDs", () => {
    expect(resolveCountryTarget("BQ")).toMatchObject({ resolved_country: "NL", country_resolution: "proxy", tld: "nl" });
    expect(resolveCountryTarget("BL")).toMatchObject({ resolved_country: "FR", country_resolution: "proxy", tld: "fr" });
    expect(resolveCountryTarget("MF")).toMatchObject({ resolved_country: "FR", country_resolution: "proxy", tld: "fr" });
    expect(resolveCountryTarget("UM")).toMatchObject({ resolved_country: "US", country_resolution: "proxy", tld: "us" });
    expect(resolveCountryTarget("EH")).toMatchObject({ resolved_country: "ES", country_resolution: "proxy", tld: "es" });
  });

  it("maps GB to .uk for ccTLD targeting", () => {
    expect(resolveCountryTarget("GB")).toMatchObject({ resolved_country: "GB", country_resolution: "exact", tld: "uk" });
  });
});

