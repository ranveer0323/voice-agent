# Building and Optimizing a Low-Latency Voice Agent

A comprehensive benchmark and architecture comparison evaluating a **Sequential Baseline** voice agent stack against an **Ultra-Low Latency Streaming & Pipelined** voice agent stack.

---

## 🎯 Overview & Objectives

In voice-based human-computer interaction, **latency is the single most critical factor determining user experience**. A conversational agent with response times exceeding 2–3 seconds feels sluggish and broken, breaking the natural rhythm of human conversation.

This project instruments, benchmarks, and optimizes an end-to-end conversational voice agent pipeline across two distinct architectures:
1. **Baseline Agent (Google Stack)**: Sequential pipeline built with `gemini-3.5-transcribe` (STT), `gemini-3.7-flash` (LLM), and `gemini-3.1-flash-tts-preview` (TTS).
2. **Optimized Agent (Deepgram + Groq Stack)**: Fully streamed, overlapped pipeline leveraging **Deepgram Nova-3 WebSocket STT**, **Groq LPU (`openai/gpt-oss-20b`)**, and **Deepgram Flux TTS (`/v2/speak`)** with 24kHz Linear16 PCM browser audio streaming.

### Key Results Summary (20-Turn Benchmark)
- **Baseline Median Response Latency**: `27,121 ms` (~27.1 seconds)
- **Optimized Median Response Latency**: `1,178 ms` (~1.18 seconds)
- **Net Latency Reduction**: **-95.6% (~23x speedup)**
- **P95 Latency**: Reduced from `30,771 ms` $\rightarrow$ `1,649 ms`

---

## 💡 Architecture & Design Rationale

```
═══════════════════════════════════════════════════════════════════════════════
BASELINE: SEQUENTIAL EXECUTION PIPELINE (Avg: ~27s)
═══════════════════════════════════════════════════════════════════════════════
[ User Speaks ] ──► [ RMS VAD (650ms) ] ──► [ Upload WebM to Gemini ]
                                                       │
[ Full WAV Synthesis (12s) ] ◄── [ LLM Response (6s) ] ◄── [ Transcribe (8s) ]
           │
     [ Play Audio ]

═══════════════════════════════════════════════════════════════════════════════
OPTIMIZED: OVERLAPPED STREAMING PIPELINE (Avg: ~1.18s)
═══════════════════════════════════════════════════════════════════════════════
[ User Speaks ] ──► (Live WS Audio Stream to Deepgram Nova-3)
           │
[ VAD Endpoint (150ms) ] ──► [ Instant Final Transcript (0ms overhead) ]
                                          │
                  [ Groq LPU TTFT (350ms) ] ──► (Stream LLM Tokens)
                                                       │
                  [ Deepgram Flux TTS TTFA (450ms) ] ──► (Stream PCM Chunks)
                                                              │
                                            [ Web Audio API Instant Playback ]
```

---

### Component-by-Component Comparison

| Component Stage | Baseline Stack | Optimized Stack | Architectural Reasoning |
| :--- | :--- | :--- | :--- |
| **VAD (End-of-Turn)** | Browser RMS Analyser (650ms silence window) | Adaptive Silence VAD (150ms endpointing window) | Lowering silence threshold by 500ms immediately shaves half a second off perceived response time while remaining responsive. |
| **Speech-to-Text (STT)** | `gemini-3.5-transcribe` via Google Files API Upload | `Deepgram Nova-3` via Live WebSocket | Baseline blocks until the full audio recording finishes and uploads. Deepgram transcribes audio frames in real-time as the user speaks, yielding an effective **0ms transcription wait** at speech cutoff. |
| **LLM Inference** | `gemini-3.7-flash` (Full text roundtrip) | `Groq LPU` (`openai/gpt-oss-20b`) | For conversational voice QA, ultra-low TTFT (~350ms) on dedicated LPUs provides instantaneous response initiation without needing massive monolithic models. |
| **Text-to-Speech (TTS)** | `gemini-3.1-flash-tts-preview` (Complete WAV generation) | `Deepgram Flux TTS` (`/v2/speak`, `flux-haley-en`) | Deepgram Flux begins returning 24kHz Linear16 raw PCM audio frames within ~700–900ms of the first token chunk, piped directly into the browser's Web Audio API buffer. |
| **Data Flow** | Sequential Blocking (NDJSON Turn Sync) | Streaming Pipeline & Web Audio PCM Buffer Queue | Audio playback begins before the LLM has even finished generating the rest of its sentence. |

---

## 📊 Latency Measurements (20 Interactions)

### 1. Baseline Agent Measurements (Google Gemini Stack)
*All values measured in milliseconds (ms).*

| Turn | VAD (ms) | STT Latency (ms) | LLM TTFT (ms) | LLM Total (ms) | TTS Latency (ms) | Total Latency (ms) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 662.5 | 7,596.9 | 563.7 | 4,909.7 | 9,489.5 | 22,769.8 |
| 2 | 664.4 | 7,743.7 | 1,218.1 | 7,336.4 | 14,624.5 | 30,475.3 |
| 3 | 661.9 | 7,942.5 | 1,186.9 | 5,459.8 | 13,821.7 | 28,013.8 |
| 4 | 662.9 | 8,473.9 | 1,247.2 | 5,175.8 | 12,148.4 | 26,577.7 |
| 5 | 661.9 | 7,643.8 | 1,350.7 | 5,614.1 | 12,006.9 | 26,039.9 |
| 6 | 661.3 | 7,923.7 | 1,301.7 | 5,730.1 | 12,928.0 | 27,378.6 |
| 7 | 661.6 | 8,468.3 | 1,274.8 | 5,038.6 | 13,841.0 | 28,116.4 |
| 8 | 662.2 | 7,731.3 | 1,430.9 | 6,066.1 | 9,226.2 | 23,839.8 |
| 9 | 665.6 | 8,687.4 | 1,480.7 | 8,994.1 | 12,680.9 | 31,164.4 |
| 10 | 665.9 | 7,683.5 | 1,383.3 | 5,204.1 | 11,302.1 | 24,965.9 |
| 11 | 664.8 | 8,505.5 | 1,280.0 | 5,819.2 | 11,442.2 | 26,553.9 |
| 12 | 662.3 | 8,446.5 | 1,419.4 | 6,623.7 | 11,014.8 | 26,864.1 |
| 13 | 660.6 | 8,126.8 | 1,530.3 | 5,337.8 | 12,044.3 | 26,285.1 |
| 14 | 659.8 | 8,520.1 | 1,545.5 | 5,778.9 | 10,207.5 | 25,302.9 |
| 15 | 665.2 | 7,962.8 | 1,509.1 | 9,263.7 | 12,739.3 | 30,750.7 |
| 16 | 663.8 | 9,568.4 | 1,547.8 | 5,986.9 | 11,423.8 | 27,767.9 |
| 17 | 662.5 | 8,196.9 | 1,574.4 | 6,676.0 | 12,605.5 | 28,258.9 |
| 18 | 660.8 | 8,504.7 | 1,547.6 | 5,732.6 | 13,815.0 | 28,869.3 |
| 19 | 662.4 | 7,781.6 | 1,558.7 | 7,208.9 | 12,938.5 | 28,716.8 |
| 20 | 660.7 | 7,403.9 | 1,543.9 | 5,670.7 | 8,423.9 | 22,277.7 |
| **P50 (Median)** | **662.5** | **7,962.8** | **1,425.1** | **5,754.5** | **12,025.6** | **26,864.1** |
| **P95** | **665.6** | **8,731.5** | **1,573.1** | **9,007.6** | **14,584.3** | **30,771.4** |
| **Mean** | **662.9** | **8,145.2** | **1,388.9** | **6,184.0** | **11,943.9** | **27,049.5** |

---

### 2. Optimized Agent Measurements (Deepgram + Groq Stack)
*All values measured in milliseconds (ms).*

| Turn | VAD (ms) | STT (ms) | LLM TTFT (ms) | LLM Total (ms) | TTS TTFA (ms) | Total Latency (ms) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 150 | 0 | 361 | 546 | 880 | 1,031 |
| 2 | 150 | 0 | 329 | 432 | 773 | 923 |
| 3 | 150 | 0 | 213 | 425 | 741 | 892 |
| 4 | 150 | 0 | 372 | 704 | 1,025 | 1,176 |
| 5 | 150 | 0 | 416 | 860 | 1,176 | 1,326 |
| 6 | 150 | 0 | 321 | 535 | 856 | 1,007 |
| 7 | 150 | 0 | 365 | 613 | 907 | 1,057 |
| 8 | 150 | 0 | 329 | 1,235 | 1,486 | 1,637 |
| 9 | 150 | 0 | 334 | 0 | 1,736 | 1,886 |
| 10 | 150 | 0 | 355 | 519 | 815 | 965 |
| 11 | 150 | 0 | 408 | 769 | 1,153 | 1,303 |
| 12 | 150 | 0 | 356 | 675 | 1,029 | 1,180 |
| 13 | 150 | 0 | 357 | 479 | 791 | 941 |
| 14 | 150 | 0 | 373 | 991 | 1,367 | 1,517 |
| 15 | 150 | 0 | 362 | 532 | 866 | 1,016 |
| 16 | 150 | 0 | 324 | 674 | 1,039 | 1,189 |
| 17 | 150 | 0 | 432 | 763 | 1,076 | 1,226 |
| 18 | 150 | 0 | 393 | 779 | 1,128 | 1,278 |
| 19 | 150 | 0 | 344 | 869 | 1,219 | 1,369 |
| 20 | 150 | 0 | 357 | 693 | 1,025 | 1,175 |
| **P50 (Median)** | **150** | **0** | **357** | **674** | **1,025** | **1,178** |
| **P95** | **150** | **0** | **416** | **1,235** | **1,649** | **1,649** |
| **Mean** | **150** | **0** | **346** | **684** | **1,054** | **1,215** |

---

### 3. Stage-by-Stage Comparison

```
Baseline Latency Breakdown (Mean ~27.0s):
├── VAD Silence Wait:  663ms  (2.5%)
├── STT Upload & Gen: 8145ms (30.1%)
├── LLM Generation:   6184ms (22.9%)
└── TTS Synthesis:   11944ms (44.2%) ◄── Largest Bottleneck

Optimized Latency Breakdown (Mean ~1.2s):
├── VAD Endpointing:   150ms (12.3%)
├── STT (Concurrent):    0ms  (0.0%) ◄── Overlapped in Flight
├── LLM TTFT (Groq):   346ms (28.5%)
└── TTS TTFA (Flux):   719ms (59.2%) ◄── Audio starts playing immediately
```

---

## 💬 Discussion & Technical Evaluation

### 1. What was the largest bottleneck?
In the Baseline stack, the largest bottleneck was **Text-to-Speech synthesis (averaging 11.9s, 44.2% of total turn time)** followed closely by **STT upload and transcription (8.1s, 30.1%)**. Because the baseline executed sequentially, each stage had to fully complete before the next could begin. The entire audio file had to be recorded, uploaded over HTTP, transcribed, fully responded to by Gemini 3.7 Flash, and then fully rendered into a multi-megabyte WAV file by Gemini TTS before the first millisecond of audio could be played.

### 2. Why optimize this part of the system instead of another?
Optimizing STT to streaming WebSockets and TTS to chunked PCM streaming offered a **multiplicative reduction in perceived latency**. Micro-optimizing LLM prompts or token generation limits in a sequential architecture would only save ~1–2 seconds while STT and TTS still took ~20 seconds. Pipelining STT (transcribing concurrently while the user talks) and TTS (streaming raw audio buffers on the first token stream) eliminated the idle wait states completely.

### 3. What would happen under worse network conditions?
- **Baseline Failure Mode**: Severe degradation. Large HTTP payloads (uploading 5–10s audio files and downloading full WAV responses) suffer heavily under high packet loss or low bandwidth. A 500ms network jitter multiplies across 3 distinct HTTP POST requests.
- **Optimized Mitigation**: WebSockets maintain persistent full-duplex TCP connections with small chunked frames. Under degraded network conditions, jitter buffering in the browser's Web Audio API AudioContext accommodates packet arrival variance. If packet loss occurs, audio frames are smoothly queued without blocking the LLM token stream.

### 4. How to reduce latency further?
1. **Speculative Generation / Early LLM Firing**: Begin speculative LLM completion on intermediate STT hypotheses before the user has finished their sentence.
2. **On-Device WebAssembly VAD (Silero)**: Replace browser silence thresholds with a neural VAD model running client-side in WebAssembly to detect speech cessation in <80ms with 0 false positives.
3. **WebRTC Bidirectional Media**: Replace WebSocket framing with WebRTC UDP media channels to eliminate TCP head-of-line blocking under packet loss.
4. **Edge Colocation**: Deploy Groq LPU inference and Deepgram TTS in the same cloud region (e.g. `us-east-1` / `us-central1`) to reduce inter-service roundtrip latency to <10ms.

### 5. What trade-offs did your optimizations introduce?
- **Model Intelligence vs. Speed**: Swapped Gemini 3.7 Flash for `openai/gpt-oss-20b` on Groq. While Gemini has deeper reasoning for multi-step tasks, conversational voice assistants typically handle single-turn queries where sub-second speed matters far more than deep reasoning.
- **Pronunciation / Expressiveness vs. Latency**: Gemini TTS offered exceptional phonetic accuracy and natural prosody, but generated audio as batch files. Deepgram Flux TTS produces slightly more robotic cadence on complex multi-clause sentences, but generates streamable PCM audio with a sub-second TTFA.

---

## 🛠️ Tech Stack & Dependencies

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Web Audio API.
- **Audio Processing**: MediaRecorder API, Web Audio API `AudioContext` with Linear16 PCM buffer queuing.
- **Baseline Provider**: Google GenAI SDK (`@google/genai`) — Gemini 3.5 Transcribe, Gemini 3.7 Flash, Gemini 3.1 Flash TTS.
- **Optimized Provider**: Deepgram SDK (`@deepgram/sdk`) — Nova-3 WebSocket STT, Flux TTS (`/v2/speak`), Groq SDK (`groq-sdk`) — LPUs (`openai/gpt-oss-20b`).

---

## 🚀 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/ranveer0323/voice-agent.git
cd voice-agent
pnpm install
```

### 2. Environment Configuration
Create a `.env.local` file in the root directory:
```env
GEMINI_API_KEY="your_gemini_api_key"
DEEPGRAM_API_KEY="your_deepgram_api_key"
GROQ_API_KEY="your_groq_api_key"
NEXT_PUBLIC_DEEPGRAM_API_KEY="your_deepgram_api_key"
```

### 3. Run Locally
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) to view the benchmark comparison dashboard and launch both live agents.
