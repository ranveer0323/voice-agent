# Building and Optimizing a Low-Latency Voice Agent

A comprehensive benchmark and architecture comparison evaluating a **Sequential Baseline** voice agent stack against an **Ultra-Low Latency Streaming & Pipelined** voice agent stack.

---

## 🎯 Overview & Objectives

In voice-based human-computer interaction, **latency is the single most critical factor determining user experience**. A conversational agent with response times exceeding 2–3 seconds feels sluggish and broken, breaking the natural rhythm of human conversation.

This project instruments, benchmarks, and optimizes an end-to-end conversational voice agent pipeline across two distinct architectures:
1. **Baseline Agent (Google Stack)**: Sequential pipeline built with `gemini-3.5-transcribe` (STT), `gemini-3.7-flash` (LLM), and `gemini-3.1-flash-tts-preview` (TTS).
2. **Optimized Agent (Deepgram + Groq Stack)**: Fully streamed, overlapped pipeline leveraging **Deepgram Nova-3 WebSocket STT**, **Groq LPU (`openai/gpt-oss-20b`)**, and **Deepgram Flux TTS (`/v2/speak`)** with 24kHz Linear16 PCM browser audio streaming.

### Key Results Summary (20-Turn Benchmark)
- **Baseline Median Response Latency**: `15,289 ms` (~15.3 seconds)
- **Optimized Median Response Latency**: `1,178 ms` (~1.18 seconds)
- **Net Latency Reduction**: **-92.3% (~13x speedup)**
- **P95 Latency**: Reduced from `17,489 ms` $\rightarrow$ `1,649 ms`

---

## 💡 Architecture & Design Rationale

```
═══════════════════════════════════════════════════════════════════════════════
BASELINE: SEQUENTIAL EXECUTION PIPELINE (Avg: ~15.3s)
═══════════════════════════════════════════════════════════════════════════════
[ User Speaks ] ──► [ RMS VAD (660ms) ] ──► [ Upload WebM to Gemini ]
                                                       │
[ Full WAV Synthesis (7.5s) ] ◄── [ LLM Response (2.3s) ] ◄── [ Transcribe (3.2s) ]
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

| Turn | VAD (ms) | STT (ms) | LLM TTFT (ms) | LLM Total (ms) | TTS Latency (ms) | Total Latency (ms) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 663 | 3,007 | 192 | 2,453 | 5,798 | 13,947 |
| 2 | 664 | 2,985 | 378 | 1,951 | 9,949 | 17,453 |
| 3 | 665 | 3,201 | 258 | 1,609 | 7,418 | 14,687 |
| 4 | 662 | 4,001 | 345 | 1,745 | 8,314 | 16,596 |
| 5 | 663 | 4,053 | 506 | 3,323 | 7,569 | 17,088 |
| 6 | 752 | 3,639 | 389 | 2,476 | 7,738 | 16,069 |
| 7 | 662 | 3,104 | 427 | 2,251 | 9,583 | 17,345 |
| 8 | 663 | 3,120 | 448 | 2,830 | 6,642 | 15,639 |
| 9 | 667 | 3,430 | 432 | 1,898 | 6,764 | 14,210 |
| 10 | 667 | 3,161 | 452 | 2,629 | 8,102 | 16,621 |
| 11 | 663 | 2,608 | 482 | 1,894 | 7,725 | 14,471 |
| 12 | 666 | 2,803 | 679 | 2,407 | 7,959 | 15,224 |
| 13 | 659 | 3,110 | 580 | 2,188 | 7,831 | 15,353 |
| 14 | 667 | 2,831 | 542 | 2,303 | 7,096 | 14,352 |
| 15 | 662 | 2,472 | 557 | 2,421 | 6,358 | 13,485 |
| 16 | 664 | 3,152 | 704 | 1,942 | 6,252 | 13,567 |
| 17 | 663 | 3,111 | 659 | 3,220 | 9,542 | 18,163 |
| 18 | 664 | 3,492 | 786 | 2,228 | 8,944 | 17,095 |
| 19 | 662 | 2,920 | 793 | 2,672 | 6,360 | 14,196 |
| 20 | 665 | 2,903 | 803 | 2,221 | 5,946 | 12,930 |
| **P50 (Median)** | **663.5** | **3,110.5** | **494.0** | **2,277.0** | **7,647.0** | **15,288.5** |
| **P95** | **667.0** | **4,003.6** | **793.5** | **3,225.2** | **9,601.3** | **17,488.5** |
| **Mean** | **668.6** | **3,195.2** | **520.6** | **2,333.1** | **7,494.5** | **15,274.6** |

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
Baseline Latency Breakdown (Mean ~15.3s):
├── VAD Silence Wait:   669ms  (4.4%)
├── STT Upload & Gen:  3195ms (20.9%)
├── LLM Generation:    2333ms (15.3%)
└── TTS Synthesis:     7495ms (49.1%) ◄── Largest Bottleneck

Optimized Latency Breakdown (Mean ~1.2s):
├── VAD Endpointing:    150ms (12.3%)
├── STT (Concurrent):     0ms  (0.0%) ◄── Overlapped in Flight
├── LLM TTFT (Groq):    346ms (28.5%)
└── TTS TTFA (Flux):    719ms (59.2%) ◄── Audio starts playing immediately
```

---

## 💬 Discussion & Technical Evaluation

### 1. What was the largest bottleneck?
In the Baseline stack, the largest bottleneck was **Text-to-Speech synthesis (averaging 7.5s, 49.1% of total turn time)** followed by **STT upload and transcription (3.2s, 20.9%)**. Because the baseline executed sequentially, each stage had to fully complete before the next could begin. The entire audio file had to be recorded, uploaded over HTTP, transcribed, fully responded to by Gemini 3.7 Flash, and then fully rendered into a WAV file by Gemini TTS before the first millisecond of audio could be played.

### 2. Why optimize this part of the system instead of another?
Optimizing STT to streaming WebSockets and TTS to chunked PCM streaming offered a **multiplicative reduction in perceived latency**. Micro-optimizing LLM prompts or token generation limits in a sequential architecture would only save ~0.5–1.0s while STT and TTS still took ~11s. Pipelining STT (transcribing concurrently while the user talks) and TTS (streaming raw audio buffers on the first token stream) eliminated the idle wait states completely.

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
