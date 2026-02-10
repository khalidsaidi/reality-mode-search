import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseStrongSegments, toPlainTextFromHtml } from "@/lib/html";
import type { SearchResult } from "@/lib/types";

export function ResultsList({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No results.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {results.map((r, idx) => (
        <Card key={`${r.url}-${idx}`}>
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-transparent underline-offset-4 hover:decoration-current"
                >
                  {parseStrongSegments(r.title || r.url).map((seg, i) =>
                    seg.strong ? (
                      <strong key={`${idx}-t-${i}`}>{seg.text}</strong>
                    ) : (
                      <React.Fragment key={`${idx}-t-${i}`}>{seg.text}</React.Fragment>
                    ),
                  )}
                </a>
              ) : (
                <span>{toPlainTextFromHtml(r.title) || "(missing url)"}</span>
              )}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{toPlainTextFromHtml(r.display_url || r.domain)}</span>
              {r.tld ? <Badge>{r.tld}</Badge> : null}
              {r.country_inferred && r.country_inferred !== "unknown" ? <Badge>{r.country_inferred}</Badge> : null}
              {r.lang_detected && r.lang_detected !== "unknown" ? (
                <Badge variant="secondary">{r.lang_detected}</Badge>
              ) : null}
            </div>
          </CardHeader>
          {r.snippet ? (
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {parseStrongSegments(r.snippet).map((seg, i) =>
                seg.strong ? (
                  <strong key={`${idx}-s-${i}`}>{seg.text}</strong>
                ) : (
                  <React.Fragment key={`${idx}-s-${i}`}>{seg.text}</React.Fragment>
                ),
              )}
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
