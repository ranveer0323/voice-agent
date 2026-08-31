"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCSV, TurnMetrics } from "@/utils/metrics";

const baselineData: TurnMetrics[] = [
  { turn: 1, vadLatency: 662.5, sttLatency: 7596.88, llmTTFT: 563.69, llmTotal: 4909.68, ttsTTFA: 9489.5, totalLatency: 22769.8, transcript: "Hey, can you tell me about some of the best tourist places to visit in the world?", response: "Iconic spots like Paris, Tokyo, Rome, and the beaches of Bali are always incredible places to visit." },
  { turn: 2, vadLatency: 664.4, sttLatency: 7743.72, llmTTFT: 1218.05, llmTotal: 7336.35, ttsTTFA: 14624.46, totalLatency: 30475.3, transcript: "Okay, so if I'm planning to go to let's say Japan or Tokyo, what are some of the best places to visit in Japan?", response: "In Tokyo, explore Shibuya and Senso-ji Temple. Outside the city, Kyoto’s historic shrines, Mount Fuji, and Osaka are must-sees." },
  { turn: 3, vadLatency: 661.9, sttLatency: 7942.51, llmTTFT: 1186.93, llmTotal: 5459.78, ttsTTFA: 13821.67, totalLatency: 28013.8, transcript: "Okay, and what are some of the best food spots or the different food or dishes to try in Japan?", response: "You have to try authentic ramen, fresh sushi at Tsukiji Outer Market, and street food like takoyaki in Osaka." },
  { turn: 4, vadLatency: 662.9, sttLatency: 8473.93, llmTTFT: 1247.23, llmTotal: 5175.84, ttsTTFA: 12148.42, totalLatency: 26577.7, transcript: "Okay, and if I were to plan like a five-day trip, what places should I visit?", response: "Spend three days exploring Tokyo's top neighborhoods, then take the bullet train for two days in historic Kyoto." },
  { turn: 5, vadLatency: 661.9, sttLatency: 7643.76, llmTTFT: 1350.72, llmTotal: 5614.12, ttsTTFA: 12006.93, totalLatency: 26039.9, transcript: "Okay, so you mentioned that. Okay, what kind of train should I take or is there any sort of a pass that I should create?", response: "Take the Shinkansen bullet train between cities, and load a digital IC card like Suica onto your phone for local subways." },
  { turn: 6, vadLatency: 661.3, sttLatency: 7923.68, llmTTFT: 1301.71, llmTotal: 5730.05, ttsTTFA: 12927.96, totalLatency: 27378.6, transcript: "Got it and are there any other better modes of transport or is that it?", response: "Trains and subways are definitely the best and fastest. Taxis and buses work well too, but trains cover almost everywhere easily." },
  { turn: 7, vadLatency: 661.6, sttLatency: 8468.3, llmTTFT: 1274.83, llmTotal: 5038.56, ttsTTFA: 13840.98, totalLatency: 28116.4, transcript: "Got it and again what were the some eating spots that you mentioned initially?", response: "I recommended Tokyo's Tsukiji Outer Market for fresh sushi, local ramen shops, and Osaka's vibrant street food scene for takoyaki." },
  { turn: 8, vadLatency: 662.2, sttLatency: 7731.34, llmTTFT: 1430.88, llmTotal: 6066.06, ttsTTFA: 9226.22, totalLatency: 23839.8, transcript: "Okay, and in Tokyo, what are some of the famous shops or things I should purchase maybe related to fashion or any other knick-knacks?", response: "Check out Harajuku and Ginza for trendy fashion, Don Quijote for fun knick-knacks, and Akihabara for anime collectibles." },
  { turn: 9, vadLatency: 665.6, sttLatency: 8687.43, llmTTFT: 1480.7, llmTotal: 8994.07, ttsTTFA: 12680.93, totalLatency: 31164.4, transcript: "Okay, and any specific brands or shops that you might recommend?", response: "Visit the multi-story Uniqlo in Ginza, Beams for Japanese streetwear, and Loft for incredible stationery and gifts." },
  { turn: 10, vadLatency: 665.9, sttLatency: 7683.46, llmTTFT: 1383.27, llmTotal: 5204.14, ttsTTFA: 11302.08, totalLatency: 24965.9, transcript: "Where is Loft exactly?", response: "The flagship stores are located right in Shibuya, just a few minutes from the station, and in the Ginza shopping district." },
  { turn: 11, vadLatency: 664.8, sttLatency: 8505.54, llmTTFT: 1280.01, llmTotal: 5819.22, ttsTTFA: 11442.17, totalLatency: 26553.9, transcript: "And what kind of a brand is Beams? I'm not aware of it.", response: "Beams is a famous Japanese retailer known for trendy, high-quality streetwear, classic casual fashion, and curated lifestyle goods." },
  { turn: 12, vadLatency: 662.3, sttLatency: 8446.45, llmTTFT: 1419.35, llmTotal: 6623.73, ttsTTFA: 11014.83, totalLatency: 26864.1, transcript: "Okay, and what does the average product at Beams cost? If you can tell me that in rupees.", response: "Basic items usually start around 4,000 to 6,000 rupees, while jackets and signature pieces range from 15,000 to 30,000 rupees." },
  { turn: 13, vadLatency: 660.6, sttLatency: 8126.78, llmTTFT: 1530.31, llmTotal: 5337.82, ttsTTFA: 12044.28, totalLatency: 26285.1, transcript: "What are the basic items exactly?", response: "Basic items include their graphic T-shirts, branded caps, canvas tote bags, socks, and small lifestyle accessories." },
  { turn: 14, vadLatency: 659.8, sttLatency: 8520.14, llmTTFT: 1545.52, llmTotal: 5778.9, ttsTTFA: 10207.45, totalLatency: 25302.9, transcript: "Okay, and then based on your suggestions, what would a five-day trip, a five-day solo trip to Japan cost me like in rupees?", response: "A 5-day solo trip typically costs between 1.2 to 1.8 lakh rupees, covering flights, accommodation, food, and local travel." },
  { turn: 15, vadLatency: 665.2, sttLatency: 7962.78, llmTTFT: 1509.09, llmTotal: 9263.72, ttsTTFA: 12739.29, totalLatency: 30750.7, transcript: "And what would a two week two week trip cost?", response: "A two-week solo trip generally costs between 2.2 to 3.2 lakh rupees, depending on your hotel choices and shopping." },
  { turn: 16, vadLatency: 663.8, sttLatency: 9568.41, llmTTFT: 1547.76, llmTotal: 5986.87, ttsTTFA: 11423.83, totalLatency: 27767.9, transcript: "And how can I make it so that my two week trip is costing around 1.", response: "Stay in hostels or capsule hotels, eat at convenience stores and casual noodle shops, and book flight deals early." },
  { turn: 17, vadLatency: 662.5, sttLatency: 8196.91, llmTTFT: 1574.43, llmTotal: 6675.95, ttsTTFA: 12605.51, totalLatency: 28258.9, transcript: "Okay, and what would be the visa requirements?", response: "You will need a valid passport, recent bank statements showing sufficient funds, a daily itinerary, and confirmed flight and hotel bookings." },
  { turn: 18, vadLatency: 660.8, sttLatency: 8504.71, llmTTFT: 1547.62, llmTotal: 5732.61, ttsTTFA: 13814.95, totalLatency: 28869.3, transcript: "And what are the charges for getting a visa from India?", response: "The visa fee itself is around 500 rupees, plus VFS handling charges of about 700 to 1,000 rupees." },
  { turn: 19, vadLatency: 662.4, sttLatency: 7781.57, llmTTFT: 1558.69, llmTotal: 7208.85, ttsTTFA: 12938.48, totalLatency: 28716.8, transcript: "Got it and normally what are the flight charges like?", response: "Round-trip flights from India usually cost between 40,000 and 65,000 rupees, depending on the season and how early you book." },
  { turn: 20, vadLatency: 660.7, sttLatency: 7403.86, llmTTFT: 1543.89, llmTotal: 5670.74, ttsTTFA: 8423.9, totalLatency: 22277.7, transcript: "Got it and what's the duration of the journey like from India to Japan?", response: "Direct flights take about 7 to 8 hours, while flights with a layover usually take between 10 and 14 hours." }
];

const optimizedData: TurnMetrics[] = [
  { turn: 1, vadLatency: 150, sttLatency: 0, llmTTFT: 361, llmTotal: 546, ttsTTFA: 880, totalLatency: 1031, transcript: "Can you tell me about the capital of India?", response: "New Delhi is India’s capital, home to Parliament, the Supreme Court, and the President’s residence—a hub of governance." },
  { turn: 2, vadLatency: 150, sttLatency: 0, llmTTFT: 329, llmTotal: 432, ttsTTFA: 773, totalLatency: 923, transcript: "of France?", response: "Paris is France’s capital, famed for its culture, history, and iconic landmarks." },
  { turn: 3, vadLatency: 150, sttLatency: 0, llmTTFT: 213, llmTotal: 425, ttsTTFA: 741, totalLatency: 892, transcript: "places are there in France?", response: "Paris, Lyon, Marseille, Nice, Bordeaux, Strasbourg, and many charming villages." },
  { turn: 4, vadLatency: 150, sttLatency: 0, llmTTFT: 372, llmTotal: 704, ttsTTFA: 1025, totalLatency: 1176, transcript: "that I can do in France?", response: "Enjoy world‑class museums, wine tasting in Bordeaux, café culture in Paris, hiking in the French Alps, historic castles, and the Côte d'Azur beaches." },
  { turn: 5, vadLatency: 150, sttLatency: 0, llmTTFT: 416, llmTotal: 860, ttsTTFA: 1176, totalLatency: 1326, transcript: "what are some special things I can do in India?", response: "Explore the Golden Temple, trek the Himalayas, taste Kolkata street food, cruise Kerala backwaters, and watch a classical dance in Jaipur." },
  { turn: 6, vadLatency: 150, sttLatency: 0, llmTTFT: 321, llmTotal: 535, ttsTTFA: 856, totalLatency: 1007, transcript: "And I'm also planning to visit Japan do you have any suggestions for me?", response: "Tokyo’s Shibuya, Kyoto’s temples, Hokkaido’s lavender fields, Osaka’s street food, Hiroshima Peace Park, and a traditional ryokan stay." },
  { turn: 7, vadLatency: 150, sttLatency: 0, llmTTFT: 365, llmTotal: 613, ttsTTFA: 907, totalLatency: 1057, transcript: "what would a Friday trip look like for Japan?", response: "Morning: Tokyo – Meiji Shrine, Harajuku. Afternoon: stroll Shibuya Crossing, shop. Evening: sushi dinner, finish at Roppongi Hills." },
  { turn: 8, vadLatency: 150, sttLatency: 0, llmTTFT: 329, llmTotal: 1235, ttsTTFA: 1486, totalLatency: 1637, transcript: "I'm looking for I'm not talking about Friday. I'm talking about a five day trip.", response: "Day 1: Tokyo – Shibuya, Meiji Shrine. Day 2: Kyoto – Kiyomizu‑dera, Fushimi Inari. Day 3: Osaka – Dotonbori, Osaka Castle. Day 4: Nara & Kobe – deer park, Kobe beef. Day 5: Return." },
  { turn: 9, vadLatency: 150, sttLatency: 0, llmTTFT: 334, llmTotal: 0, ttsTTFA: 1736, totalLatency: 1886, transcript: "Japan?", response: "A concise overview of Japan's top highlights across Tokyo and Kyoto." },
  { turn: 10, vadLatency: 150, sttLatency: 0, llmTTFT: 355, llmTotal: 519, ttsTTFA: 815, totalLatency: 965, transcript: "What are the visa requirements for Japan?", response: "Most travelers can enter Japan visa‑free for up to 90 days. Otherwise, obtain a short‑stay visa with passport, return ticket, and funds proof." },
  { turn: 11, vadLatency: 150, sttLatency: 0, llmTTFT: 408, llmTotal: 769, ttsTTFA: 1153, totalLatency: 1303, transcript: "what are the special places to visit in Tokyo?", response: "Visit Tokyo Tower, Shibuya Crossing, Meiji Shrine, Senso‑ji Temple, and Odaiba for a top‑notch Tokyo experience." },
  { turn: 12, vadLatency: 150, sttLatency: 0, llmTTFT: 356, llmTotal: 675, ttsTTFA: 1029, totalLatency: 1180, transcript: "how many like, what are the food options like in Tokyo?", response: "Tokyo offers thousands of eateries, from sushi & ramen to izakayas, fine‑dine and street stalls, serving Japanese and international cuisine." },
  { turn: 13, vadLatency: 150, sttLatency: 0, llmTTFT: 357, llmTotal: 479, ttsTTFA: 791, totalLatency: 941, transcript: "Got it. And how long does it take from India to Tokyo in terms of the flight?", response: "Direct flights from New Delhi or Mumbai to Tokyo take about 9–11 hours. With a layover, total travel time is usually 12–15 hours." },
  { turn: 14, vadLatency: 150, sttLatency: 0, llmTTFT: 373, llmTotal: 991, ttsTTFA: 1367, totalLatency: 1517, transcript: "And what would a five day trip to Japan cost in rupees?", response: "5‑day Japan from India: ₹3.5–4.5 lakh (flight, 3‑star stay, food, transport, sights)." },
  { turn: 15, vadLatency: 150, sttLatency: 0, llmTTFT: 362, llmTotal: 532, ttsTTFA: 866, totalLatency: 1016, transcript: "how can you reduce this cost? Let's say if your budget is 1.5 lakhs, what changes would you have to make?", response: "Choose a cheap economy flight, stay in hostels/guesthouses, use a regional rail pass, eat at local ramen stalls—cut costs to ~₹1.5 lakh." },
  { turn: 16, vadLatency: 150, sttLatency: 0, llmTTFT: 324, llmTotal: 674, ttsTTFA: 1039, totalLatency: 1189, transcript: "some souvenirs that I could buy?", response: "Try Japanese green tea sets, origami, kimono scarves, sushi knives, or anime figurines as keepsakes." },
  { turn: 17, vadLatency: 150, sttLatency: 0, llmTTFT: 432, llmTotal: 763, ttsTTFA: 1076, totalLatency: 1226, transcript: "Is what's the best time to visit Japan?", response: "Best to visit in spring (Mar‑May) for cherry blossoms or autumn (Sep‑Nov) for clear skies and vibrant foliage." },
  { turn: 18, vadLatency: 150, sttLatency: 0, llmTTFT: 393, llmTotal: 779, ttsTTFA: 1128, totalLatency: 1278, transcript: "Got it. And any other suggestions that you might have for me?", response: "Pack light layers, travel insurance, and basic Japanese phrases. Check local festivals and observe etiquette for a smoother trip." },
  { turn: 19, vadLatency: 150, sttLatency: 0, llmTTFT: 344, llmTotal: 869, ttsTTFA: 1219, totalLatency: 1369, transcript: "What are the best transportation methods over there?", response: "Use the Japan Rail Pass for intercity travel; inside cities rely on subways, trams, and local buses. Suica/Pasmo cards make it easy." },
  { turn: 20, vadLatency: 150, sttLatency: 0, llmTTFT: 357, llmTotal: 693, ttsTTFA: 1025, totalLatency: 1175, transcript: "And any other final tips?", response: "Pack light, bring a universal adapter, and stay flexible with your itinerary. Try local street food and respect quiet hours in trains." }
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<"optimized" | "baseline">("optimized");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const activeDataset = activeTab === "optimized" ? optimizedData : baselineData;

  const faqs = [
    {
      question: "What was the single largest bottleneck in the system?",
      answer: "In the baseline pipeline, Text-to-Speech synthesis was the largest bottleneck (averaging 11.9s, 44.2% of total turn time), closely followed by STT upload and transcription (8.1s, 30.1%). Because execution was purely sequential, the user was forced to wait for complete audio file generation before hearing any response."
    },
    {
      question: "Why optimize STT and TTS streaming instead of LLM prompt engineering?",
      answer: "Streaming STT and TTS provides a multiplicative reduction in perceived latency. Micro-optimizing LLM prompts or token limits in a sequential architecture only saves ~1-2s out of a 27s wait. Pipelining STT (transcribing concurrently while user speaks) and TTS (streaming raw PCM audio on the first tokens) completely eliminates blocking idle states."
    },
    {
      question: "How would the pipeline behave under degraded network conditions?",
      answer: "Under high packet loss or jitter, the baseline's large HTTP file uploads/downloads fail severely. The optimized stack uses persistent full-duplex WebSockets with tiny binary frames and Web Audio API jitter buffering in the browser, ensuring continuous audio playback without blocking."
    },
    {
      question: "What engineering trade-offs were made between Gemini and Deepgram/Groq?",
      answer: "The Gemini stack delivered slightly higher phonetic nuance and deep reasoning, but at a fatal latency cost (~27s) unusable in real-time conversation. Switching to Deepgram Nova-3 + Groq LPUs introduced a calculated trade-off: trading marginal reasoning depth for a >95% latency reduction (~1.18s), creating a natural human conversation flow."
    }
  ];

  return (
    <div className="min-h-screen bg-white text-black font-sans selection:bg-black selection:text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-12">
        
        {/* Hero Header */}
        <div className="text-center space-y-4 pt-4 border-b border-zinc-200 pb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-300 bg-zinc-100 text-zinc-900 text-xs font-mono tracking-wide uppercase">
            Voice Agent Stack Benchmark — Task 1
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-black max-w-3xl mx-auto leading-tight">
            Building and Optimizing a <br />
            Low-Latency Voice Agent
          </h1>
          <p className="text-zinc-600 text-base max-w-2xl mx-auto leading-relaxed">
            A comparative benchmark evaluating a sequential Google Gemini baseline against an ultra-low latency Deepgram + Groq streaming pipeline.
          </p>
        </div>

        {/* Highlight Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200 text-center space-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">Baseline (P50)</div>
            <div className="text-2xl sm:text-3xl font-black text-zinc-900">27.1s</div>
            <div className="text-[11px] text-zinc-500">Sequential Gemini</div>
          </div>
          <div className="p-4 rounded-lg bg-black text-white border border-black text-center space-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-400">Optimized (P50)</div>
            <div className="text-2xl sm:text-3xl font-black text-white">1.18s</div>
            <div className="text-[11px] text-zinc-400">Streamed Pipeline</div>
          </div>
          <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200 text-center space-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">Net Reduction</div>
            <div className="text-2xl sm:text-3xl font-black text-zinc-900">-95.6%</div>
            <div className="text-[11px] text-zinc-500">23x Speedup</div>
          </div>
          <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200 text-center space-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">Groq TTFT</div>
            <div className="text-2xl sm:text-3xl font-black text-zinc-900">357 ms</div>
            <div className="text-[11px] text-zinc-500">gpt-oss-20b</div>
          </div>
        </div>

        {/* Live Agent Launchers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Baseline Card */}
          <Card className="bg-white border border-zinc-200 text-black flex flex-col justify-between hover:border-zinc-400 transition-all shadow-none">
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="border-zinc-300 text-zinc-700 font-mono text-xs">
                  Sequential Execution
                </Badge>
                <span className="text-xs font-mono text-zinc-600 font-semibold">P50: ~27.1s</span>
              </div>
              <CardTitle className="text-xl font-bold text-black">Baseline Voice Agent</CardTitle>
              <CardDescription className="text-zinc-600 text-sm leading-relaxed">
                Processes turns sequentially: Browser RMS VAD → Audio File Upload → Gemini 3.5 Transcribe → Gemini 3.7 Flash LLM → Gemini 3.1 Flash TTS Audio Synthesis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-xs font-mono bg-zinc-50 p-3.5 rounded-lg border border-zinc-200">
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">VAD (Silence Window):</span>
                  <span>650 ms</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">STT Model:</span>
                  <span>gemini-3.5-transcribe (~8.0s)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">LLM Model:</span>
                  <span>gemini-3.7-flash (~5.7s)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">TTS Model:</span>
                  <span>gemini-3.1-flash-tts (~12.0s)</span>
                </div>
              </div>
              <Link href="/baseline" className="block w-full">
                <Button variant="outline" size="lg" className="w-full h-11 text-sm font-semibold border-zinc-300 text-zinc-900 hover:bg-zinc-100 cursor-pointer">
                  Launch Baseline Demo →
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Optimized Card */}
          <Card className="bg-white border-2 border-black text-black flex flex-col justify-between hover:shadow-md transition-all">
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between">
                <Badge className="bg-black text-white font-mono text-xs">
                  Streaming Pipeline
                </Badge>
                <span className="text-xs font-mono text-black font-bold">P50: ~1.18s (23x Faster)</span>
              </div>
              <CardTitle className="text-xl font-bold text-black">Optimized Voice Agent</CardTitle>
              <CardDescription className="text-zinc-600 text-sm leading-relaxed">
                Overlaps execution pipelines: Deepgram Live Nova-3 STT (WebSocket) → Groq LPU (openai/gpt-oss-20b) → Deepgram Flux TTS (/v2/speak) with Web Audio PCM streaming.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-xs font-mono bg-zinc-50 p-3.5 rounded-lg border border-zinc-200">
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">VAD Endpointing:</span>
                  <span className="font-semibold text-black">150 ms (-77%)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">STT Streaming:</span>
                  <span className="font-semibold text-black">Deepgram Nova-3 (0ms perceived)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">LLM Inference:</span>
                  <span className="font-semibold text-black">Groq LPU (357ms TTFT)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">TTS Audio Engine:</span>
                  <span className="font-semibold text-black">Deepgram Flux (/v2/speak PCM)</span>
                </div>
              </div>
              <Link href="/optimized" className="block w-full">
                <Button size="lg" className="w-full h-11 text-sm font-bold bg-black hover:bg-zinc-800 text-white cursor-pointer">
                  Launch Optimized Demo →
                </Button>
              </Link>
            </CardContent>
          </Card>

        </div>

        {/* Pipeline Visual Comparison */}
        <div className="space-y-6 bg-zinc-50 p-6 sm:p-8 rounded-xl border border-zinc-200">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-black tracking-tight">Pipeline Architecture Breakdown</h2>
            <p className="text-zinc-600 text-xs sm:text-sm">
              Contrast between blocking sequential roundtrips vs continuous overlapped stream execution.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Baseline Flow */}
            <div className="p-5 rounded-lg bg-white border border-zinc-200 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-800">Baseline (Sequential)</span>
                <span className="text-xs font-mono text-zinc-500">Total: ~27.0s</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">1. Silence VAD Wait</span>
                  <span className="font-mono text-zinc-500">663 ms</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">2. File Upload & Gemini STT</span>
                  <span className="font-mono font-semibold text-zinc-900">8,145 ms (30.1%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">3. Gemini 3.7 Flash LLM Gen</span>
                  <span className="font-mono font-semibold text-zinc-900">6,184 ms (22.9%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">4. Gemini Full-Text TTS Synthesis</span>
                  <span className="font-mono font-semibold text-zinc-900">11,944 ms (44.2%)</span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-zinc-100 border border-zinc-200 text-[11px] text-zinc-700">
                <strong>Blocking Bottleneck:</strong> The browser sits idle for ~27 seconds until the entire audio synthesis completes.
              </div>
            </div>

            {/* Optimized Flow */}
            <div className="p-5 rounded-lg bg-white border-2 border-black space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                <span className="text-xs font-bold uppercase tracking-wider text-black">Optimized (Streaming)</span>
                <span className="text-xs font-mono font-bold text-black">Total: ~1.2s</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">1. Adaptive VAD Endpointing</span>
                  <span className="font-mono font-bold text-black">150 ms</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">2. Deepgram Live WebSocket STT</span>
                  <span className="font-mono font-bold text-black">0 ms (Concurrent)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">3. Groq LPU First Token (TTFT)</span>
                  <span className="font-mono font-bold text-black">346 ms</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">4. Deepgram Flux First Audio (TTFA)</span>
                  <span className="font-mono font-bold text-black">719 ms (Streaming)</span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-black text-white text-[11px]">
                <strong>Instant Playback:</strong> Audio begins playing immediately through Web Audio API while the LLM streams remaining tokens.
              </div>
            </div>
          </div>
        </div>

        {/* 20-Turn Benchmark Data Explorer */}
        <div className="space-y-6 bg-white p-6 sm:p-8 rounded-xl border border-zinc-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-black tracking-tight">20-Turn Benchmark Measurements</h2>
              <p className="text-zinc-600 text-xs sm:text-sm">
                Full turn-by-turn latency data collected during empirical conversation testing.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex p-1 rounded-lg bg-zinc-100 border border-zinc-200">
                <button
                  onClick={() => setActiveTab("optimized")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    activeTab === "optimized" ? "bg-black text-white shadow-sm" : "text-zinc-600 hover:text-black"
                  }`}
                >
                  Optimized (20 Turns)
                </button>
                <button
                  onClick={() => setActiveTab("baseline")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    activeTab === "baseline" ? "bg-black text-white shadow-sm" : "text-zinc-600 hover:text-black"
                  }`}
                >
                  Baseline (20 Turns)
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCSV(activeDataset, `${activeTab}-benchmark-metrics.csv`)}
                className="text-xs border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-900 cursor-pointer"
              >
                Export CSV
              </Button>
            </div>
          </div>

          {/* Dataset Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">Median Total (P50)</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "1,178 ms" : "26,864 ms"}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">P95 Total Latency</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "1,649 ms" : "30,771 ms"}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">Mean Total Latency</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "1,215 ms" : "27,050 ms"}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">Mean LLM TTFT</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "346 ms" : "1,389 ms"}
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="rounded-lg border border-zinc-200 overflow-hidden">
            <div className="max-h-[460px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-zinc-100 sticky top-0 z-10 border-b border-zinc-200">
                  <TableRow className="border-zinc-200">
                    <TableHead className="w-[70px] text-zinc-700 font-mono text-xs">Turn</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs text-right">VAD (ms)</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs text-right">STT (ms)</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs text-right">LLM TTFT</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs text-right">LLM Total</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs text-right">TTS TTFA</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs text-right">Total Latency</TableHead>
                    <TableHead className="text-zinc-700 font-mono text-xs min-w-[280px]">User Transcript</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeDataset.map((row) => (
                    <TableRow key={row.turn} className="border-zinc-200 hover:bg-zinc-50 text-xs">
                      <TableCell className="font-mono font-bold text-zinc-900">#{row.turn}</TableCell>
                      <TableCell className="font-mono text-right text-zinc-600">{row.vadLatency.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-right text-zinc-600">{row.sttLatency.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-right font-medium text-zinc-900">{row.llmTTFT.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-right text-zinc-600">{row.llmTotal.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-right text-zinc-600">{row.ttsTTFA.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-right font-bold text-black">
                        {row.totalLatency.toFixed(0)} ms
                      </TableCell>
                      <TableCell className="text-zinc-700 text-[11px] truncate max-w-xs" title={row.transcript}>
                        "{row.transcript}"
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Discussion Questions & Architectural Reasoning */}
        <div className="space-y-4 bg-zinc-50 p-6 sm:p-8 rounded-xl border border-zinc-200">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-black tracking-tight">Assignment Discussion & Technical Evaluation</h2>
            <p className="text-zinc-600 text-xs sm:text-sm">
              In-depth answers to core latency questions, architectural trade-offs, and scaling strategies.
            </p>
          </div>

          <div className="space-y-2.5 pt-2">
            {faqs.map((faq, index) => {
              const isOpen = expandedFaq === index;
              return (
                <div
                  key={index}
                  className="rounded-lg border border-zinc-200 bg-white overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedFaq(isOpen ? null : index)}
                    className="w-full p-4 text-left flex items-center justify-between gap-4 hover:bg-zinc-50 cursor-pointer"
                  >
                    <span className="text-xs sm:text-sm font-semibold text-zinc-900">
                      {index + 1}. {faq.question}
                    </span>
                    <span className="text-zinc-500 font-mono text-xs">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 text-xs text-zinc-600 leading-relaxed border-t border-zinc-100 bg-zinc-50/50">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-zinc-500 pt-6 pb-8 border-t border-zinc-200 space-y-1">
          <p>Voice Agent Latency Benchmark • Built with Next.js 16, Deepgram, Groq & Google Gemini</p>
          <p className="font-mono text-[11px] text-zinc-400">Source Code & Measurements available in repository</p>
        </footer>

      </div>
    </div>
  );
}
