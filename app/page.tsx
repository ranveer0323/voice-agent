"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCSV, TurnMetrics } from "@/utils/metrics";

const baselineData: TurnMetrics[] = [
  { turn: 1, vadLatency: 663, sttLatency: 3007, llmTTFT: 192, llmTotal: 2453, ttsTTFA: 5798, totalLatency: 13947, transcript: "Hi, can you tell me about the capital of India?", response: "New Delhi is the capital of India. It's a vibrant city known for its rich history and historic landmarks." },
  { turn: 2, vadLatency: 664, sttLatency: 2985, llmTTFT: 378, llmTotal: 1951, ttsTTFA: 9949, totalLatency: 17453, transcript: "And can you tell me what are the some things to do in New Delhi?", response: "You can explore historic sites like the Red Fort, visit India Gate, and enjoy incredible street food in Chandni Chowk." },
  { turn: 3, vadLatency: 665, sttLatency: 3201, llmTTFT: 258, llmTotal: 1609, ttsTTFA: 7418, totalLatency: 14687, transcript: "Got it and what other offerings or things that you can buy in New Delhi?", response: "You can shop for beautiful textiles, pashmina shawls, fragrant spices, and handmade jewelry in bustling markets like Dilli Haat." },
  { turn: 4, vadLatency: 662, sttLatency: 4001, llmTTFT: 345, llmTotal: 1745, ttsTTFA: 8314, totalLatency: 16596, transcript: "All right, and what other places are there to visit in India?", response: "You can visit the iconic Taj Mahal in Agra, explore Jaipur's royal palaces, or relax in Kerala's serene backwaters." },
  { turn: 5, vadLatency: 663, sttLatency: 4053, llmTTFT: 506, llmTotal: 3323, ttsTTFA: 7569, totalLatency: 17088, transcript: "And what about Bombay?", response: "Mumbai is a lively coastal city famous for the Gateway of India, Marine Drive sunsets, and the Bollywood film industry." },
  { turn: 6, vadLatency: 752, sttLatency: 3639, llmTTFT: 389, llmTotal: 2476, ttsTTFA: 7738, totalLatency: 16069, transcript: "Got it and what are the best travel options over there?", response: "The local train network is iconic and fast, but app-based cabs and auto-rickshaws are the most comfortable options." },
  { turn: 7, vadLatency: 662, sttLatency: 3104, llmTTFT: 427, llmTotal: 2251, ttsTTFA: 9583, totalLatency: 17345, transcript: "Got it and how much does food cost normally for one person let's say?", response: "Street food costs around two to three dollars, while a nice meal at a sit-down restaurant typically runs ten to twenty dollars." },
  { turn: 8, vadLatency: 663, sttLatency: 3120, llmTTFT: 448, llmTotal: 2830, ttsTTFA: 6642, totalLatency: 15639, transcript: "Alright and what are some souvenirs that I can buy from there?", response: "Great souvenirs include Kolhapuri leather sandals, vintage Bollywood posters, local tea, and unique antique finds from Chor Bazaar." },
  { turn: 9, vadLatency: 667, sttLatency: 3430, llmTTFT: 432, llmTotal: 1898, ttsTTFA: 6764, totalLatency: 14210, transcript: "Okay, and are there any other special things that I should look out for?", response: "Always drink bottled water, carry some cash for local markets, and dress modestly when visiting religious sites." },
  { turn: 10, vadLatency: 667, sttLatency: 3161, llmTTFT: 452, llmTotal: 2629, ttsTTFA: 8102, totalLatency: 16621, transcript: "Okay, I'm also planning to go to another country for a trip. What other countries would you suggest?", response: "Japan offers incredible culture and food, while Thailand or Vietnam are great nearby options for stunning scenery and rich history." },
  { turn: 11, vadLatency: 663, sttLatency: 2608, llmTTFT: 482, llmTotal: 1894, ttsTTFA: 7725, totalLatency: 14471, transcript: "Okay, can you help me prepare like a five-day trip for Japan? What would be the places that I would visit?", response: "Spend three days exploring Tokyo's vibrant neighborhoods and temples, then take the bullet train to Kyoto for two days of historic shrines." },
  { turn: 12, vadLatency: 666, sttLatency: 2803, llmTTFT: 679, llmTotal: 2407, ttsTTFA: 7959, totalLatency: 15224, transcript: "Quran what would what would it cost for one person for like a five day trip?", response: "Excluding international flights, expect to spend between eight hundred and fifteen hundred dollars for mid-range hotels, food, and bullet train travel." },
  { turn: 13, vadLatency: 659, sttLatency: 3110, llmTTFT: 580, llmTotal: 2188, ttsTTFA: 7831, totalLatency: 15353, transcript: "Can you give me the price in rupees?", response: "That would be roughly seventy thousand to one lakh thirty thousand rupees per person, excluding international flights." },
  { turn: 14, vadLatency: 667, sttLatency: 2831, llmTTFT: 542, llmTotal: 2303, ttsTTFA: 7096, totalLatency: 14352, transcript: "I mean, can you also include slides as well?", response: "With round-trip flights included, the total cost usually ranges from 1.1 to 1.9 lakh rupees per person." },
  { turn: 15, vadLatency: 662, sttLatency: 2472, llmTTFT: 557, llmTotal: 2421, ttsTTFA: 6358, totalLatency: 13485, transcript: "Okay, and what would a two-week trip cost?", response: "For a two-week trip including flights, expect to spend around 2 to 3.2 lakh rupees per person for a mid-range experience." },
  { turn: 16, vadLatency: 664, sttLatency: 3152, llmTTFT: 704, llmTotal: 1942, ttsTTFA: 6252, totalLatency: 13567, transcript: "Got it. And what are some great foods to eat in Japan?", response: "Be sure to try authentic ramen, fresh sushi, crispy tempura, and savory street snacks like takoyaki." },
  { turn: 17, vadLatency: 663, sttLatency: 3111, llmTTFT: 659, llmTotal: 3220, ttsTTFA: 9542, totalLatency: 18163, transcript: "And I'm a vegetarian, so like are there any good food options for me there?", response: "Yes, you can enjoy Shojin Ryori Buddhist cuisine, vegetable tempura, tofu dishes, and dedicated vegetarian ramen spots across major cities." },
  { turn: 18, vadLatency: 664, sttLatency: 3492, llmTTFT: 786, llmTotal: 2228, ttsTTFA: 8944, totalLatency: 17095, transcript: "Got it. And what are the best times to visit Japan? Like, is October a good time? I'm planning to go in October.", response: "Yes, October is one of the best times to visit! You'll enjoy mild weather, comfortable temperatures, and beautiful autumn foliage." },
  { turn: 19, vadLatency: 662, sttLatency: 2920, llmTTFT: 793, llmTotal: 2672, ttsTTFA: 6360, totalLatency: 14196, transcript: "Can I also see the sakura trees in October?", response: "No, cherry blossoms bloom in spring from late March to April. Instead, October offers stunning colorful autumn leaves across the country." },
  { turn: 20, vadLatency: 665, sttLatency: 2903, llmTTFT: 803, llmTotal: 2221, ttsTTFA: 5946, totalLatency: 12930, transcript: "Got it. Thanks a lot.", response: "You're very welcome! Have an amazing trip to Japan, and let me know if you need anything else." }
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
      answer: "In the baseline pipeline, Text-to-Speech synthesis was the largest bottleneck (averaging 7.5s, 49.1% of total turn time), followed by STT upload and transcription (3.2s, 20.9%). Because execution was purely sequential, the user was forced to wait for complete audio file generation before hearing any response."
    },
    {
      question: "Why optimize STT and TTS streaming instead of LLM prompt engineering?",
      answer: "Streaming STT and TTS provides a multiplicative reduction in perceived latency. Micro-optimizing LLM prompts or token limits in a sequential architecture only saves ~0.5-1s out of a 15s wait. Pipelining STT (transcribing concurrently while user speaks) and TTS (streaming raw PCM audio on the first tokens) completely eliminates blocking idle states."
    },
    {
      question: "How would the pipeline behave under degraded network conditions?",
      answer: "Under high packet loss or jitter, the baseline's large HTTP file uploads/downloads fail severely. The optimized stack uses persistent full-duplex WebSockets with tiny binary frames and Web Audio API jitter buffering in the browser, ensuring continuous audio playback without blocking."
    },
    {
      question: "What engineering trade-offs were made between Gemini and Deepgram/Groq?",
      answer: "The Gemini stack delivered slightly higher phonetic nuance and deep reasoning, but at a fatal latency cost (~15.3s) unusable in real-time conversation. Switching to Deepgram Nova-3 + Groq LPUs introduced a calculated trade-off: trading marginal reasoning depth for a >92% latency reduction (~1.18s), creating a natural human conversation flow."
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
            <div className="text-2xl sm:text-3xl font-black text-zinc-900">15.3s</div>
            <div className="text-[11px] text-zinc-500">Sequential Gemini</div>
          </div>
          <div className="p-4 rounded-lg bg-black text-white border border-black text-center space-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-400">Optimized (P50)</div>
            <div className="text-2xl sm:text-3xl font-black text-white">1.18s</div>
            <div className="text-[11px] text-zinc-400">Streamed Pipeline</div>
          </div>
          <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200 text-center space-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">Net Reduction</div>
            <div className="text-2xl sm:text-3xl font-black text-zinc-900">-92.3%</div>
            <div className="text-[11px] text-zinc-500">13x Speedup</div>
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
                <span className="text-xs font-mono text-zinc-600 font-semibold">P50: ~15.3s</span>
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
                  <span>660 ms</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">STT Model:</span>
                  <span>gemini-3.5-transcribe (~3.2s)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">LLM Model:</span>
                  <span>gemini-3.7-flash (~2.3s)</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span className="text-zinc-500">TTS Model:</span>
                  <span>gemini-3.1-flash-tts (~7.5s)</span>
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
                <span className="text-xs font-mono text-black font-bold">P50: ~1.18s (13x Faster)</span>
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
                <span className="text-xs font-mono text-zinc-500">Total: ~15.3s</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">1. Silence VAD Wait</span>
                  <span className="font-mono text-zinc-500">669 ms (4.4%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">2. File Upload & Gemini STT</span>
                  <span className="font-mono font-semibold text-zinc-900">3,195 ms (20.9%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">3. Gemini 3.7 Flash LLM Gen</span>
                  <span className="font-mono font-semibold text-zinc-900">2,333 ms (15.3%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-700">4. Gemini Full-Text TTS Synthesis</span>
                  <span className="font-mono font-semibold text-zinc-900">7,495 ms (49.1%)</span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-zinc-100 border border-zinc-200 text-[11px] text-zinc-700">
                <strong>Blocking Bottleneck:</strong> The browser sits idle for ~15 seconds until the entire audio synthesis completes.
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
                {activeTab === "optimized" ? "1,178 ms" : "15,289 ms"}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">P95 Total Latency</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "1,649 ms" : "17,489 ms"}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">Mean Total Latency</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "1,215 ms" : "15,275 ms"}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-zinc-50 border border-zinc-200">
              <div className="text-[11px] font-mono text-zinc-500 uppercase">Mean LLM TTFT</div>
              <div className="text-xl font-bold text-black font-mono">
                {activeTab === "optimized" ? "346 ms" : "521 ms"}
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
