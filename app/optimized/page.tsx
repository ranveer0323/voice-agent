"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TurnMetrics, calculatePercentile, downloadCSV } from "@/utils/metrics";

type Status = "idle" | "listening" | "processing" | "playing";
type StageStatus = "idle" | "pending" | "running" | "completed" | "error";

interface StageState {
  status: StageStatus;
  latency?: number;
  ttft?: number;
  ttfa?: number;
  detail?: string;
}

interface LogEntry {
  id: string;
  time: string;
  stage: string;
  message: string;
  type: "info" | "success" | "warn" | "error";
}

export default function OptimizedAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [metrics, setMetrics] = useState<TurnMetrics[]>([]);
  const [transcript, setTranscript] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [vadStateText, setVadStateText] = useState("Idle");

  // Multi-Turn Chat History
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const chatHistoryRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  // Pipeline Stage Tracking
  const [stageVAD, setStageVAD] = useState<StageState>({ status: "idle" });
  const [stageSTT, setStageSTT] = useState<StageState>({ status: "idle" });
  const [stageLLM, setStageLLM] = useState<StageState>({ status: "idle" });
  const [stageTTS, setStageTTS] = useState<StageState>({ status: "idle" });
  const [stagePlayback, setStagePlayback] = useState<StageState>({ status: "idle" });

  // Execution Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(true);

  // Deepgram WebSockets (STT + Flux TTS) & Audio Refs
  const sttWs = useRef<WebSocket | null>(null);
  const ttsWs = useRef<WebSocket | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const keepAliveInterval = useRef<NodeJS.Timeout | null>(null);
  const isListeningActive = useRef(false);
  const t_user_silence_start = useRef<number>(0);
  const currentTurnProcessed = useRef(false);
  const continuousModeRef = useRef(true);
  const abortController = useRef<AbortController | null>(null);

  // Web Audio API for Seamless 24kHz Linear16 PCM Streaming Playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTime = useRef<number>(0);
  const activeSources = useRef<AudioBufferSourceNode[]>([]);
  const isTurnFlushed = useRef<boolean>(false);
  const t_tts_start = useRef<number>(0);
  const t_first_audio_played = useRef<number>(0);
  const currentTurnMetrics = useRef<Partial<TurnMetrics>>({});

  const addLog = (stage: string, message: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = `${now.toTimeString().split(" ")[0]}.${now.getMilliseconds().toString().padStart(3, "0")}`;
    setLogs((prev) => [...prev.slice(-100), { id: Math.random().toString(), time, stage, message, type }]);
  };

  const getAudioContext = (): AudioContext => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const resetStages = () => {
    setStageVAD({ status: "running" });
    setStageSTT({ status: "running" });
    setStageLLM({ status: "pending" });
    setStageTTS({ status: "pending" });
    setStagePlayback({ status: "pending" });
  };

  const startKeepAlive = () => {
    stopKeepAlive();
    keepAliveInterval.current = setInterval(() => {
      if (sttWs.current && sttWs.current.readyState === WebSocket.OPEN) {
        sttWs.current.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 3000);
  };

  const stopKeepAlive = () => {
    if (keepAliveInterval.current) {
      clearInterval(keepAliveInterval.current);
      keepAliveInterval.current = null;
    }
  };

  const interruptPlayback = () => {
    if (ttsWs.current && ttsWs.current.readyState === WebSocket.OPEN) {
      ttsWs.current.send(JSON.stringify({ type: "Interrupt" }));
    }
    activeSources.current.forEach((src) => {
      try {
        src.stop();
      } catch {}
    });
    activeSources.current = [];
    nextPlayTime.current = 0;
    if (abortController.current) {
      abortController.current.abort();
      abortController.current = null;
    }
  };

  const playbackCheckTimer = useRef<NodeJS.Timeout | null>(null);
  const isSpeechMetadataReceived = useRef<boolean>(false);

  const checkPlaybackEnded = () => {
    if (playbackCheckTimer.current) {
      clearTimeout(playbackCheckTimer.current);
    }

    playbackCheckTimer.current = setTimeout(() => {
      const ctx = audioCtxRef.current;
      const isTimeFinished = !ctx || ctx.currentTime >= (nextPlayTime.current - 0.05);

      if (
        isTurnFlushed.current &&
        isSpeechMetadataReceived.current &&
        activeSources.current.length === 0 &&
        isTimeFinished
      ) {
        addLog("PLAYBACK", "Agent finished speaking", "info");
        setStagePlayback((prev) => ({ ...prev, status: "completed" }));

        if (continuousModeRef.current && sttWs.current && sttWs.current.readyState === WebSocket.OPEN) {
          resumeListening();
        } else {
          setStatus("idle");
          setVadStateText("Idle (Ready)");
        }
      }
    }, 100);
  };

  const startInteraction = async () => {
    try {
      setStatus("listening");
      setTranscript("");
      setAgentResponse("");
      setVadStateText("Connecting to Deepgram STT & Flux TTS...");
      currentTurnProcessed.current = false;
      resetStages();
      addLog("DEEPGRAM", "Requesting token...", "info");

      // 1. Fetch Deepgram Token
      const res = await fetch("/api/deepgram-token");
      const data = await res.json();
      if (!data.key) {
        throw new Error(data.error || "Failed to retrieve Deepgram token");
      }
      const key = data.key;

      // 2. Initialize Web Audio Context
      getAudioContext();

      // 3. Connect to Deepgram Flux TTS WebSocket (/v2/speak)
      const ttsUrl = `wss://api.deepgram.com/v2/speak?model=flux-haley-en&encoding=linear16&sample_rate=24000`;
      const fluxSocket = new WebSocket(ttsUrl, ["token", key]);
      fluxSocket.binaryType = "arraybuffer";
      ttsWs.current = fluxSocket;

      fluxSocket.onopen = () => {
        addLog("TTS", "⚡ Connected to Deepgram Flux TTS WebSocket (/v2/speak, flux-haley-en)", "success");
      };

      fluxSocket.onmessage = (event) => {
        // Binary Audio Chunk from Flux TTS
        if (event.data instanceof ArrayBuffer) {
          const rawBuffer = event.data;
          if (rawBuffer.byteLength === 0) return;

          // Track Time-to-First-Audio (TTFA)
          if (!currentTurnMetrics.current.ttsTTFA && t_tts_start.current > 0) {
            const ttfa = performance.now() - t_tts_start.current;
            currentTurnMetrics.current.ttsTTFA = ttfa;
            setStageTTS((prev) => ({ ...prev, ttfa, status: "running", detail: "Streaming audio frames" }));
            addLog("TTS", `⚡ First Flux audio frame received (TTFA: ${ttfa.toFixed(0)}ms)`, "success");
          }

          const ctx = getAudioContext();
          const pcm16 = new Int16Array(rawBuffer);
          const float32 = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768.0;
          }

          const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
          audioBuffer.copyToChannel(float32, 0);

          const now = ctx.currentTime;
          if (nextPlayTime.current < now) {
            nextPlayTime.current = now;
          }

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.start(nextPlayTime.current);

          setStatus("playing");
          setVadStateText("Agent speaking (Deepgram Flux audio streaming)...");
          setStagePlayback((prev) => ({ ...prev, status: "running" }));

          // Measure Turn-to-First-Playback Latency
          if (t_first_audio_played.current === 0) {
            t_first_audio_played.current = performance.now();
            const total = t_first_audio_played.current - t_user_silence_start.current;
            currentTurnMetrics.current.totalLatency = total;
            setStagePlayback({ status: "completed", latency: total });
            addLog("PLAYBACK", `⚡ Total turn-to-audio latency: ${total.toFixed(0)}ms`, "success");

            setMetrics((prev) => [
              ...prev,
              {
                turn: prev.length + 1,
                vadLatency: currentTurnMetrics.current.vadLatency ?? 0,
                sttLatency: currentTurnMetrics.current.sttLatency ?? 0,
                llmTTFT: currentTurnMetrics.current.llmTTFT ?? 0,
                llmTotal: currentTurnMetrics.current.llmTotal ?? 0,
                ttsTTFA: currentTurnMetrics.current.ttsTTFA ?? 0,
                llmTtft: currentTurnMetrics.current.llmTTFT ?? 0,
                llmLatency: currentTurnMetrics.current.llmTotal ?? 0,
                ttsLatency: currentTurnMetrics.current.ttsTTFA ?? 0,
                totalLatency: total,
                transcript: currentTurnMetrics.current.transcript || "User speech",
                response: currentTurnMetrics.current.response || agentResponse || "Agent response"
              }
            ]);
          }

          nextPlayTime.current += audioBuffer.duration;
          activeSources.current.push(source);

          source.onended = () => {
            activeSources.current = activeSources.current.filter((s) => s !== source);
            checkPlaybackEnded();
          };
        } else if (typeof event.data === "string") {
          // JSON Control Messages from Flux TTS
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "SpeechStarted") {
              addLog("TTS", `Flux SpeechStarted (speech_id: ${msg.speech_id})`, "info");
            } else if (msg.type === "Flushed") {
              isTurnFlushed.current = true;
              addLog("TTS", `Flux Flushed (speech_id: ${msg.speech_id})`, "info");
              checkPlaybackEnded();
            } else if (msg.type === "SpeechMetadata") {
              isSpeechMetadataReceived.current = true;
              setStageTTS((prev) => ({
                ...prev,
                status: "completed",
                detail: `Duration: ${msg.duration ? `${msg.duration.toFixed(2)}s` : "completed"}`
              }));
              addLog("TTS", `Flux SpeechMetadata: duration ${msg.duration?.toFixed(2)}s, chars: ${msg.characters_spoken || msg.text_spoken?.length || ""}`, "info");
              checkPlaybackEnded();
            } else if (msg.type === "Warning" || msg.type === "Error") {
              console.warn("Flux TTS warning/error:", msg);
              addLog("TTS", `Flux message: ${msg.message || msg.type}`, msg.type === "Error" ? "error" : "warn");
            }
          } catch (e) {
            console.error("Flux WS JSON parse error:", e);
          }
        }
      };

      fluxSocket.onerror = (err) => {
        console.error("Flux TTS WebSocket error:", err);
        addLog("TTS", "Flux TTS WebSocket connection error", "error");
      };

      // 4. Connect to Deepgram STT WebSocket (/v1/listen)
      const sttUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&endpointing=350&interim_results=true&utterance_end_ms=1000`;
      const listenSocket = new WebSocket(sttUrl, ["token", key]);
      sttWs.current = listenSocket;

      listenSocket.onopen = async () => {
        setVadStateText("Listening... (Speak anytime)");
        addLog("MIC", "Accessing microphone stream...", "info");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
        mediaStream.current = stream;

        let mimeType = "audio/webm";
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        }

        mediaRecorder.current = new MediaRecorder(stream, { mimeType });
        mediaRecorder.current.ondataavailable = (e) => {
          if (isListeningActive.current && e.data && e.data.size > 0 && sttWs.current?.readyState === WebSocket.OPEN) {
            sttWs.current.send(e.data);
          }
        };

        isListeningActive.current = true;
        mediaRecorder.current.start(150);
        addLog("STT", "Live audio streaming to Deepgram Nova-3 active (150ms chunks)", "success");
      };

      listenSocket.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Deepgram Live Transcript & Endpointing
          const alt = msg.channel?.alternatives?.[0];
          const text = alt?.transcript?.trim();

          if (text && isListeningActive.current) {
            setTranscript(text);
            setStageSTT((prev) => ({ ...prev, detail: text }));
          }

          // Barge-in detection: if user speaks while audio is playing
          if (text && activeSources.current.length > 0) {
            interruptPlayback();
            addLog("BARGE-IN", `User interrupted: "${text}"`, "warn");
          }

          if (isListeningActive.current && (msg.speech_final || (msg.is_final && text && msg.speech_final !== false))) {
            if (text && !currentTurnProcessed.current) {
              currentTurnProcessed.current = true;
              isListeningActive.current = false;
              startKeepAlive();
              t_user_silence_start.current = performance.now() - 150;
              const vadLatency = Math.max(0, performance.now() - t_user_silence_start.current);
              addLog("VAD", `Speech endpoint detected: "${text}"`, "success");
              processTurn(text, vadLatency);
            }
          } else if (isListeningActive.current && msg.type === "UtteranceEnd") {
            if (transcript && !currentTurnProcessed.current) {
              currentTurnProcessed.current = true;
              isListeningActive.current = false;
              startKeepAlive();
              t_user_silence_start.current = performance.now() - 250;
              const vadLatency = Math.max(0, performance.now() - t_user_silence_start.current);
              addLog("VAD", `Utterance end detected (VAD: ${vadLatency.toFixed(0)}ms)`, "success");
              processTurn(transcript, vadLatency);
            }
          }
        } catch (parseErr) {
          console.warn("Deepgram STT message parse error:", parseErr);
        }
      };

      listenSocket.onerror = (err) => {
        console.error("Deepgram STT WebSocket Error:", err);
        addLog("DEEPGRAM", "STT WebSocket connection error", "error");
      };

      listenSocket.onclose = () => {
        stopKeepAlive();
      };

    } catch (err: any) {
      console.error("Optimized Agent error:", err);
      setTranscript(`Error: ${err.message || "Failed to connect to Deepgram"}`);
      addLog("ERROR", err.message || "Connection failed", "error");
      setStatus("idle");
    }
  };

  const resumeListening = () => {
    stopKeepAlive();
    currentTurnProcessed.current = false;
    isListeningActive.current = true;
    isTurnFlushed.current = false;
    isSpeechMetadataReceived.current = false;
    t_first_audio_played.current = 0;
    setStatus("listening");
    setVadStateText("Listening... (Speak anytime)");
    addLog("MIC", "Mic active, ready for next turn (KeepAlive stopped)", "info");
  };

  const processTurn = async (userText: string, vadLatency: number) => {
    setStatus("processing");
    setVadStateText("Streaming Groq LLM tokens directly to Deepgram Flux TTS...");
    setStageVAD({ status: "completed", latency: vadLatency });
    setStageSTT({ status: "completed", latency: 0, detail: userText });
    setStageLLM({ status: "running" });
    setStageTTS({ status: "pending" });
    setStagePlayback({ status: "pending" });
    setTranscript(userText);
    setAgentResponse("");

    addLog("LLM", `Sent prompt to Groq (openai/gpt-oss-20b)${chatHistoryRef.current.length > 0 ? ` with ${Math.round(chatHistoryRef.current.length / 2)} turn(s) history` : ""}: "${userText}"`, "info");

    currentTurnMetrics.current = {
      vadLatency,
      sttLatency: 0,
      transcript: userText
    };

    t_tts_start.current = performance.now();
    t_first_audio_played.current = 0;
    isTurnFlushed.current = false;

    // Interrupt any previous playback and prepare fresh controller
    interruptPlayback();
    abortController.current = new AbortController();

    try {
      const res = await fetch("/api/chat-optimized", {
        method: "POST",
        body: JSON.stringify({
          transcript: userText,
          history: chatHistoryRef.current
        }),
        headers: { "Content-Type": "application/json" },
        signal: abortController.current.signal
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          try {
            const data = JSON.parse(chunk);

            if (data.type === "ttft") {
              currentTurnMetrics.current.llmTTFT = data.time;
              setStageLLM((prev) => ({ ...prev, ttft: data.time, status: "running" }));
              addLog("LLM", `⚡ First token received from Groq (TTFT: ${data.time.toFixed(0)}ms)`, "success");
            }

            if (data.type === "token" && data.text) {
              fullResponse += data.text;
              setAgentResponse(fullResponse);

              // Stream LLM token immediately to Deepgram Flux TTS WebSocket!
              if (ttsWs.current && ttsWs.current.readyState === WebSocket.OPEN) {
                ttsWs.current.send(JSON.stringify({ type: "Speak", text: data.text }));
              }
            }

            if (data.type === "llm_done") {
              const completedText = data.fullResponse || fullResponse;
              currentTurnMetrics.current.llmTotal = data.time;
              currentTurnMetrics.current.response = completedText;
              setStageLLM((prev) => ({
                ...prev,
                status: "completed",
                latency: data.time,
                detail: completedText
              }));

              // Update multi-turn history
              if (userText && completedText) {
                setChatHistory((prev) => [
                  ...prev,
                  { role: "user", content: userText },
                  { role: "assistant", content: completedText }
                ]);
              }

              addLog("LLM", `Groq LLM stream finished in ${data.time.toFixed(0)}ms. Sending Flush to Flux TTS...`, "success");

              // Flush ends the turn in Deepgram Flux TTS
              if (ttsWs.current && ttsWs.current.readyState === WebSocket.OPEN) {
                ttsWs.current.send(JSON.stringify({ type: "Flush" }));
              }
            }
          } catch (e) {
            console.error("NDJSON chunk parse error:", e);
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        addLog("LLM", "LLM stream aborted due to interruption", "warn");
        return;
      }
      console.error("processTurn error:", err);
      setAgentResponse(`Error: ${err.message || "Failed to process turn"}`);
      addLog("ERROR", err.message || "Processing failed", "error");
      if (continuousModeRef.current) {
        setTimeout(() => resumeListening(), 1000);
      } else {
        setStatus("idle");
      }
    }
  };

  const clearHistory = () => {
    setChatHistory([]);
    addLog("APP", "Conversation history reset", "info");
  };

  const stopAll = () => {
    isListeningActive.current = false;
    stopKeepAlive();
    interruptPlayback();

    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
    }
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((t) => t.stop());
    }
    if (sttWs.current && (sttWs.current.readyState === WebSocket.OPEN || sttWs.current.readyState === WebSocket.CONNECTING)) {
      sttWs.current.close();
    }
    if (ttsWs.current && (ttsWs.current.readyState === WebSocket.OPEN || ttsWs.current.readyState === WebSocket.CONNECTING)) {
      ttsWs.current.close();
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    setStatus("idle");
    setVadStateText("Idle");
    addLog("APP", "Conversation stopped by user", "info");
  };

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  // Metrics Calcs
  const totalLatencies = metrics.map((m) => m.totalLatency);
  const ttftLatencies = metrics.map((m) => m.llmTTFT ?? m.llmTtft ?? 0);
  const ttfaLatencies = metrics.map((m) => m.ttsTTFA ?? m.ttsLatency ?? 0);
  const p50Total = calculatePercentile(totalLatencies, 50);
  const p95Total = calculatePercentile(totalLatencies, 95);
  const p50TTFT = calculatePercentile(ttftLatencies, 50);
  const p95TTFT = calculatePercentile(ttftLatencies, 95);
  const p50TTFA = calculatePercentile(ttfaLatencies, 50);
  const p95TTFA = calculatePercentile(ttfaLatencies, 95);

  const getStageBadge = (stage: StageState, defaultLabel: string) => {
    switch (stage.status) {
      case "idle":
        return <Badge variant="secondary" className="text-slate-400 font-normal">Waiting</Badge>;
      case "pending":
        return <Badge variant="outline" className="text-slate-400">Pending</Badge>;
      case "running":
        return <Badge className="bg-blue-600 text-white animate-pulse">Running...</Badge>;
      case "completed":
        return (
          <Badge className="bg-emerald-600 text-white flex gap-1 items-center">
            <span>✓</span>
            <span>{stage.latency !== undefined ? `${stage.latency.toFixed(0)}ms` : "Done"}</span>
          </Badge>
        );
      case "error":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{defaultLabel}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-900 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header & Controls */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/">
                <Button variant="outline" size="sm">← Back</Button>
              </Link>
              <h1 className="text-3xl font-bold tracking-tight">Optimized Voice Agent</h1>
            </div>
            <p className="text-slate-500">
              Deepgram Nova-3 STT (WebSocket) → Groq LLM (openai/gpt-oss-20b) → Deepgram Flux TTS (flux-haley-en /v2/speak)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {chatHistory.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearHistory}
                className="text-xs h-8 text-slate-600 hover:text-slate-900 cursor-pointer bg-white"
              >
                Clear History ({Math.round(chatHistory.length / 2)} turns)
              </Button>
            )}
            <Badge
              variant={status === "idle" ? "secondary" : "default"}
              className={`px-4 py-1.5 text-sm uppercase tracking-widest ${
                status === "listening" ? "bg-amber-500 text-white animate-pulse" :
                status === "processing" ? "bg-blue-600 text-white" :
                status === "playing" ? "bg-emerald-600 text-white" : ""
              }`}
            >
              {status}
            </Badge>
          </div>
        </div>

        {/* Live Pipeline Lifecycle Tracker Card */}
        <Card className="border-blue-200 bg-white shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-base font-semibold text-slate-900">Live Streaming Pipeline Stage Tracker</CardTitle>
                <CardDescription>Direct streaming WebSocket voice pipeline with Deepgram Flux TTS (/v2/speak)</CardDescription>
              </div>
              <div className="text-xs text-slate-500 font-mono bg-slate-100 px-2.5 py-1 rounded">
                Status: <span className="font-semibold text-slate-700">{vadStateText}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">

              {/* Stage 1: VAD */}
              <div className={`p-3 rounded-lg border transition-all ${stageVAD.status === 'running' ? 'border-amber-400 bg-amber-50/50' : stageVAD.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">1. 🎤 VAD</span>
                  {getStageBadge(stageVAD, "VAD")}
                </div>
                <p className="text-[10px] font-mono text-slate-500">Deepgram Endpointing</p>
                {stageVAD.latency !== undefined && (
                  <p className="text-xs font-mono font-medium text-emerald-700 mt-1">{stageVAD.latency.toFixed(0)}ms</p>
                )}
              </div>

              {/* Stage 2: STT */}
              <div className={`p-3 rounded-lg border transition-all ${stageSTT.status === 'running' ? 'border-blue-400 bg-blue-50/50' : stageSTT.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">2. 📝 STT</span>
                  {getStageBadge(stageSTT, "STT")}
                </div>
                <p className="text-[10px] font-mono text-blue-600 font-medium truncate">Deepgram Nova-3 WS</p>
                <p className="text-xs font-mono font-medium text-emerald-700 mt-1">Real-time (0ms)</p>
              </div>

              {/* Stage 3: LLM & TTFT */}
              <div className={`p-3 rounded-lg border transition-all ${stageLLM.status === 'running' ? 'border-blue-400 bg-blue-50/50' : stageLLM.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">3. 🧠 LLM</span>
                  {getStageBadge(stageLLM, "LLM")}
                </div>
                <p className="text-[10px] font-mono text-purple-600 font-medium truncate" title="openai/gpt-oss-20b">
                  openai/gpt-oss-20b
                </p>
                <div className="flex flex-col gap-0.5 mt-1">
                  {stageLLM.ttft !== undefined && (
                    <span className="text-[11px] font-mono text-purple-700 font-semibold">
                      TTFT: {stageLLM.ttft.toFixed(0)}ms
                    </span>
                  )}
                  {stageLLM.latency !== undefined && (
                    <span className="text-xs font-mono font-medium text-emerald-700">
                      Total: {stageLLM.latency.toFixed(0)}ms
                    </span>
                  )}
                </div>
              </div>

              {/* Stage 4: TTS */}
              <div className={`p-3 rounded-lg border transition-all ${stageTTS.status === 'running' ? 'border-blue-400 bg-blue-50/50' : stageTTS.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">4. 🔊 TTS</span>
                  {getStageBadge(stageTTS, "TTS")}
                </div>
                <p className="text-[10px] font-mono text-amber-600 font-medium truncate" title="Deepgram Flux TTS (/v2/speak)">
                  Flux (flux-haley-en)
                </p>
                <div className="flex flex-col gap-0.5 mt-1">
                  {stageTTS.ttfa !== undefined && (
                    <span className="text-[11px] font-mono text-amber-700 font-semibold">
                      TTFA: {stageTTS.ttfa.toFixed(0)}ms
                    </span>
                  )}
                  {stageTTS.detail && (
                    <span className="text-[10px] font-mono text-slate-500 truncate">{stageTTS.detail}</span>
                  )}
                </div>
              </div>

              {/* Stage 5: Playback */}
              <div className={`p-3 rounded-lg border transition-all ${stagePlayback.status === 'running' ? 'border-emerald-400 bg-emerald-50/50' : stagePlayback.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">5. 🎧 Output</span>
                  {getStageBadge(stagePlayback, "Audio")}
                </div>
                <p className="text-[10px] font-mono text-slate-500">24kHz PCM Web Audio</p>
                {stagePlayback.latency !== undefined && (
                  <p className="text-xs font-mono font-bold text-emerald-800 mt-1">Total: {stagePlayback.latency.toFixed(0)}ms</p>
                )}
              </div>

            </div>

            {/* Conversation Output Box */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-slate-50 rounded-md border text-xs">
                <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">User Transcript (Deepgram STT)</span>
                <p className="text-slate-800 font-medium whitespace-pre-wrap">{transcript || "Waiting for user speech..."}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-md border text-xs">
                <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">Agent Response (Groq LLM → Flux TTS)</span>
                <p className="text-slate-800 font-medium whitespace-pre-wrap">{agentResponse || "Waiting for response generation..."}</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-center gap-3 pt-2">
              {status === "idle" && (
                <Button
                  onClick={startInteraction}
                  size="lg"
                  className="w-52 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer font-medium"
                >
                  Start Speaking
                </Button>
              )}

              {status === "listening" && (
                <Button
                  onClick={stopAll}
                  variant="destructive"
                  size="lg"
                  className="w-48 cursor-pointer"
                >
                  Stop Listening
                </Button>
              )}

              {status === "processing" && (
                <Button disabled size="lg" className="w-52 bg-slate-400 text-white">
                  Streaming LLM & TTS...
                </Button>
              )}

              {status === "playing" && (
                <Button
                  onClick={stopAll}
                  variant="outline"
                  size="lg"
                  className="w-52 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                >
                  Agent Speaking (Stop)
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Metrics Dashboard */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Latency Measurements</CardTitle>
              <CardDescription>Overlapped streaming benchmarks (Deepgram Nova-3 STT + Groq TTFT + Deepgram Flux TTFA)</CardDescription>
            </div>
            <div className="flex gap-4 items-center">
              <div className="text-xs bg-slate-100 p-2 rounded border space-y-0.5">
                <div>
                  <span className="font-semibold text-slate-700">Total Latency:</span> p50: <span className="font-bold">{p50Total.toFixed(0)}ms</span> | p95: <span className="font-bold">{p95Total.toFixed(0)}ms</span>
                </div>
                <div className="flex gap-3">
                  <span><span className="font-semibold text-purple-700">Groq TTFT:</span> p50: <span className="font-bold text-purple-800">{p50TTFT.toFixed(0)}ms</span></span>
                  <span><span className="font-semibold text-amber-700">Flux TTFA:</span> p50: <span className="font-bold text-amber-800">{p50TTFA.toFixed(0)}ms</span></span>
                </div>
              </div>
              <Button variant="outline" onClick={() => downloadCSV(metrics, "optimized_metrics.csv")} disabled={metrics.length === 0}>
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Turn</TableHead>
                  <TableHead>VAD (ms)</TableHead>
                  <TableHead>STT (ms)</TableHead>
                  <TableHead className="text-purple-700 font-semibold">Groq TTFT (ms)</TableHead>
                  <TableHead>LLM Total (ms)</TableHead>
                  <TableHead className="text-amber-700 font-semibold">Flux TTFA (ms)</TableHead>
                  <TableHead className="text-right font-bold">Total (ms)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500 py-6">
                      No data yet. Click &apos;Start Speaking&apos; to test the optimized pipeline with Deepgram Flux TTS!
                    </TableCell>
                  </TableRow>
                ) : (
                  metrics.map((m) => (
                    <TableRow key={m.turn}>
                      <TableCell className="font-medium">{m.turn}</TableCell>
                      <TableCell>{(m.vadLatency ?? 0).toFixed(0)}</TableCell>
                      <TableCell>{(m.sttLatency ?? 0).toFixed(0)}</TableCell>
                      <TableCell className="text-purple-700 font-semibold">{(m.llmTTFT ?? m.llmTtft ?? 0).toFixed(0)}</TableCell>
                      <TableCell>{(m.llmTotal ?? m.llmLatency ?? 0).toFixed(0)}</TableCell>
                      <TableCell className="text-amber-700 font-semibold">{(m.ttsTTFA ?? m.ttsLatency ?? 0).toFixed(0)}</TableCell>
                      <TableCell className="text-right font-bold">{(m.totalLatency ?? 0).toFixed(0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Execution Log Terminal */}
        <Card className="border-slate-800 bg-slate-950 text-slate-100">
          <CardHeader className="py-3 px-4 border-b border-slate-800 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
              <span className="text-xs font-mono font-medium text-slate-300 ml-2">Streaming Pipeline Execution Logs</span>
            </div>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer font-mono"
            >
              {showLogs ? "Hide Console" : "Show Console"}
            </button>
          </CardHeader>
          {showLogs && (
            <CardContent className="p-3 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1 bg-black/40">
              {logs.length === 0 ? (
                <div className="text-slate-500">Ready. Start an interaction to stream real-time pipeline execution logs...</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="flex gap-2 items-start leading-relaxed">
                    <span className="text-slate-500 select-none">[{l.time}]</span>
                    <span
                      className={`font-semibold px-1 py-0.2 rounded text-[10px] ${
                        l.stage === "STT" || l.stage === "DEEPGRAM" ? "bg-blue-950 text-blue-300" :
                        l.stage === "LLM" ? "bg-purple-950 text-purple-300" :
                        l.stage === "TTS" ? "bg-amber-950 text-amber-300" :
                        l.stage === "VAD" ? "bg-emerald-950 text-emerald-300" :
                        l.stage === "BARGE-IN" ? "bg-amber-900 text-amber-200" :
                        "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {l.stage}
                    </span>
                    <span
                      className={`${
                        l.type === "error" ? "text-red-400 font-semibold" :
                        l.type === "success" ? "text-emerald-400" :
                        l.type === "warn" ? "text-amber-300" : "text-slate-300"
                      }`}
                    >
                      {l.message}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          )}
        </Card>

      </div>
    </div>
  );
}
