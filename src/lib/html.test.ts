import { describe, expect, it } from "vitest";

import { decodeHtmlEntities, parseStrongSegments, toPlainTextFromHtml } from "./html";

describe("decodeHtmlEntities", () => {
  it("decodes common named entities", () => {
    expect(decodeHtmlEntities("&quot;hi&quot; &amp; &lt;ok&gt;")).toBe("\"hi\" & <ok>");
  });

  it("decodes numeric entities (hex and decimal)", () => {
    expect(decodeHtmlEntities("a&#x27;b&#39;c")).toBe("a'b'c");
  });
});

describe("parseStrongSegments", () => {
  it("keeps <strong> text as highlighted segments and strips other tags", () => {
    const segs = parseStrongSegments('x <strong>y</strong> &quot;z&quot; <em>t</em> &lt;script&gt;bad&lt;/script&gt;');
    const rendered = segs.map((s) => (s.strong ? `<s>${s.text}</s>` : s.text)).join("");
    expect(rendered).toBe('x <s>y</s> "z" t bad');
  });
});

describe("toPlainTextFromHtml", () => {
  it("strips tags and decodes entities", () => {
    expect(toPlainTextFromHtml("<strong>The</strong> &quot;test&quot;")).toBe('The "test"');
  });
});

