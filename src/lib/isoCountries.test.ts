import { describe, expect, it } from "vitest";

import { ISO_COUNTRIES, ISO_COUNTRY_COUNT } from "@/lib/isoCountries";

describe("isoCountries", () => {
  it("is complete (249 entries)", () => {
    expect(ISO_COUNTRY_COUNT).toBe(249);
    expect(ISO_COUNTRIES).toHaveLength(249);
  });

  it("has unique codes", () => {
    const codes = ISO_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

