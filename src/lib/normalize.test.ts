import { describe, expect, it } from "vitest";

import { MAX_QUERY_LENGTH, normalizeQuery } from "@/lib/normalize";

describe("normalizeQuery", () => {
  it("trims, collapses whitespace, and lowercases", () => {
    expect(normalizeQuery("  Hello   WORLD \n")).toBe("hello world");
  });

  it("enforces a max length", () => {
    const raw = "a".repeat(MAX_QUERY_LENGTH + 50);
    expect(normalizeQuery(raw)).toHaveLength(MAX_QUERY_LENGTH);
  });
});

