import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-900 font-sans">
      <div className="max-w-4xl w-full space-y-8">
        
        {/* Hero Card */}
        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-3">
              <Badge variant="outline" className="text-xs px-3 py-1 font-mono uppercase tracking-wider text-blue-600 border-blue-200 bg-blue-50">
                Voice Pipeline Benchmark
              </Badge>
            </div>
            <CardTitle className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Voice Agent Architecture A/B Test
            </CardTitle>
            <CardDescription className="text-base sm:text-lg text-slate-600 mt-2 max-w-2xl mx-auto">
              Compare a sequential baseline pipeline against an ultra-low latency streaming architecture powered by Deepgram STT, Groq LPUs, and chunked Gemini TTS.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="pt-4 pb-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Baseline Option Card */}
              <div className="p-6 rounded-xl border border-slate-200 bg-slate-50/70 hover:border-slate-300 transition-all flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-800">Baseline Agent</h2>
                    <Badge variant="secondary" className="font-mono text-xs">Sequential</Badge>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Processes turns sequentially: Browser RMS VAD → Complete STT Audio Upload → Gemini 3.7 Flash LLM → Full Sentence Gemini TTS Audio.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1.5 pt-2">
                    <li className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-bold">•</span> STT: gemini-3.5-transcribe
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-bold">•</span> LLM: gemini-3.7-flash
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-bold">•</span> TTS: gemini-3.1-flash-tts-preview
                    </li>
                  </ul>
                </div>
                <div className="pt-6">
                  <Link href="/baseline" className="block w-full">
                    <Button size="lg" variant="outline" className="w-full h-12 text-base font-semibold border-slate-300 hover:bg-slate-100 cursor-pointer">
                      Launch Baseline
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Optimized Option Card */}
              <div className="p-6 rounded-xl border-2 border-blue-500/80 bg-blue-50/30 hover:border-blue-600 transition-all flex flex-col justify-between shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-blue-950">Optimized Agent</h2>
                    <Badge className="bg-blue-600 text-white font-mono text-xs">Streaming</Badge>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Overlaps execution pipelines: Deepgram Live Nova-3 STT → Groq LPU LLM (openai/gpt-oss-20b) → Deepgram Flux TTS (/v2/speak) with Web Audio PCM streaming & barge-in.
                  </p>
                  <ul className="text-xs text-blue-900/80 space-y-1.5 pt-2 font-medium">
                    <li className="flex items-center gap-1.5">
                      <span className="text-blue-500 font-bold">•</span> STT: Deepgram Nova-3 (WebSocket)
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-blue-500 font-bold">•</span> LLM: Groq openai/gpt-oss-20b (Ultra-fast TTFT)
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-blue-500 font-bold">•</span> TTS: Deepgram Flux TTS (flux-haley-en /v2/speak)
                    </li>
                  </ul>
                </div>
                <div className="pt-6">
                  <Link href="/optimized" className="block w-full">
                    <Button size="lg" className="w-full h-12 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm cursor-pointer">
                      Launch Optimized
                    </Button>
                  </Link>
                </div>
              </div>

            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
