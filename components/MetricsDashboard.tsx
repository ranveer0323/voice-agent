import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TurnMetrics, calculatePercentile, downloadCSV } from "@/utils/metrics";

export function MetricsDashboard({ metrics, title }: { metrics: TurnMetrics[]; title: string }) {
  const totalLatencies = metrics.map((m) => m.totalLatency);
  const p50 = calculatePercentile(totalLatencies, 50);
  const p95 = calculatePercentile(totalLatencies, 95);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Latency Measurements</CardTitle>
          <CardDescription>Target: 20 interactions.</CardDescription>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-sm">
            <span className="font-semibold text-slate-900">p50:</span> {p50.toFixed(0)}ms
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-semibold text-slate-900">p95:</span> {p95.toFixed(0)}ms
          </div>
          <Button
            variant="outline"
            onClick={() => downloadCSV(metrics, `${title.toLowerCase()}_metrics.csv`)}
            disabled={metrics.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Turn</TableHead>
              <TableHead>VAD</TableHead>
              <TableHead>STT</TableHead>
              <TableHead>LLM TTFT</TableHead>
              <TableHead>LLM Total</TableHead>
              <TableHead>TTS TTFA</TableHead>
              <TableHead className="text-right font-bold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500 py-6">
                  No data yet.
                </TableCell>
              </TableRow>
            ) : (
              metrics.map((m) => (
                <TableRow key={m.turn}>
                  <TableCell>{m.turn}</TableCell>
                  <TableCell>{(m.vadLatency ?? 0).toFixed(0)}</TableCell>
                  <TableCell>{(m.sttLatency ?? 0).toFixed(0)}</TableCell>
                  <TableCell>{(m.llmTTFT ?? m.llmTtft ?? 0).toFixed(0)}</TableCell>
                  <TableCell>{(m.llmTotal ?? m.llmLatency ?? 0).toFixed(0)}</TableCell>
                  <TableCell>{(m.ttsTTFA ?? m.ttsLatency ?? 0).toFixed(0)}</TableCell>
                  <TableCell className="text-right font-bold">{(m.totalLatency ?? 0).toFixed(0)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
