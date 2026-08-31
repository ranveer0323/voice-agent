export interface TurnMetrics {
  turn: number;
  vadLatency: number;
  sttLatency: number;
  llmTtft: number;
  llmLatency: number;
  ttsLatency: number;
  totalLatency: number;
  transcript: string;
  response: string;
}

export function calculatePercentile(data: number[], percentile: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function downloadCSV(metrics: TurnMetrics[]) {
  const headers = [
    "Turn",
    "VAD Latency (ms)",
    "STT Latency (ms)",
    "LLM TTFT (ms)",
    "LLM Latency (ms)",
    "TTS Latency (ms)",
    "Total Latency (ms)",
    "Transcript",
    "Response"
  ];
  const rows = metrics.map(m => [
    m.turn,
    m.vadLatency.toFixed(2),
    m.sttLatency.toFixed(2),
    m.llmTtft.toFixed(2),
    m.llmLatency.toFixed(2),
    m.ttsLatency.toFixed(2),
    m.totalLatency.toFixed(2),
    `"${(m.transcript || "").replace(/"/g, '""')}"`,
    `"${(m.response || "").replace(/"/g, '""')}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "baseline_metrics.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
