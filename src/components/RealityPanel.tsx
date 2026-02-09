import * as React from "react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RealityPanel as RealityPanelData } from "@/lib/reality";

function HistogramTable({ title, rows }: { title: string; rows: { key: string; count: number; pct: number }[] }) {
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Pct</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-mono text-xs">{r.key}</TableCell>
                <TableCell className="text-right">{r.count}</TableCell>
                <TableCell className="text-right">{r.pct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function RealityPanel({ reality }: { reality: RealityPanelData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reality Panel</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge>Total: {reality.total_results}</Badge>
          <Badge>Distinct domains: {reality.distinct_domains}</Badge>
          <Badge>Distinct TLDs: {reality.distinct_tlds}</Badge>
          <Badge>Countries inferred: {reality.distinct_countries_inferred}</Badge>
        </div>

        <p className="text-xs text-muted-foreground">Stats are observational. Results are not re-ranked.</p>

        <Accordion>
          <AccordionItem open>
            <AccordionTrigger>Breakdowns</AccordionTrigger>
            <AccordionContent className="grid gap-6">
              <HistogramTable title="TLD" rows={reality.histograms.tld} />
              <HistogramTable title="Country (inferred from TLD)" rows={reality.histograms.country_inferred} />
              <HistogramTable title="Language (detected)" rows={reality.histograms.lang_detected} />
              <HistogramTable title="Top domains" rows={reality.histograms.top_domains} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

