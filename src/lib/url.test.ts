import { describe, expect, it } from "vitest";

import { canonicalizeUrl, dedupByCanonicalUrl } from "@/lib/url";

describe("url", () => {
  it("canonicalizeUrl removes tracking params + fragments and sorts query params", () => {
    const raw = "https://Example.com/path?utm_source=x&b=2&a=1&gclid=123#section";
    expect(canonicalizeUrl(raw)).toBe("https://example.com/path?a=1&b=2");
  });

  it("dedupByCanonicalUrl keeps first occurrence and preserves order", () => {
    const input = [
      { url: "https://example.com/a?utm_source=1" },
      { url: "https://EXAMPLE.com/a" },
      { url: "https://example.com/b" }
    ];

    const out = dedupByCanonicalUrl(input);
    expect(out.map((r) => r.url)).toEqual(["https://example.com/a?utm_source=1", "https://example.com/b"]);
  });
});

