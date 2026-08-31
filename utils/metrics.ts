export interface TurnMetrics {
  turn: number;
  vadLatency: number;
  sttLatency: number;
  llmTTFT: number;
  llmTotal: number;
  ttsTTFA: number;
  totalLatency: number;
  transcript: string;
  response: string;
  // Backward compatibility alias support
  llmTtft?: number;
  llmLatency?: number;
  ttsLatency?: number;
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

export function downloadCSV(metrics: TurnMetrics[], filename: string = "metrics.csv") {
  const headers = [
    "Turn",
    "VAD (ms)",
    "STT (ms)",
    "LLM TTFT (ms)",
    "LLM Total (ms)",
    "TTS TTFA (ms)",
    "Total Latency (ms)",
    "Transcript",
    "Response"
  ];
  const rows = metrics.map(m => [
    m.turn,
    (m.vadLatency ?? 0).toFixed(0),
    (m.sttLatency ?? 0).toFixed(0),
    (m.llmTTFT ?? m.llmTtft ?? 0).toFixed(0),
    (m.llmTotal ?? m.llmLatency ?? 0).toFixed(0),
    (m.ttsTTFA ?? m.ttsLatency ?? 0).toFixed(0),
    (m.totalLatency ?? 0).toFixed(0),
    `"${(m.transcript || "").replace(/"/g, '""')}"`,
    `"${(m.response || "").replace(/"/g, '""')}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
