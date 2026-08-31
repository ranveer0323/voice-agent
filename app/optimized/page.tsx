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
  const [continuousMode, setContinuousMode] = useState(true);

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

  // Audio, KeepAlive & WebSocket Refs
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const keepAliveInterval = useRef<NodeJS.Timeout | null>(null);
  const isListeningActive = useRef(false);
  const t_user_silence_start = useRef<number>(0);
  const audioQueue = useRef<HTMLAudioElement[]>([]);
  const isPlaying = useRef(false);
  const currentTurnProcessed = useRef(false);
  const continuousModeRef = useRef(true);

  useEffect(() => {
    continuousModeRef.current = continuousMode;
  }, [continuousMode]);

  const addLog = (stage: string, message: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = `${now.toTimeString().split(" ")[0]}.${now.getMilliseconds().toString().padStart(3, "0")}`;
    setLogs((prev) => [...prev.slice(-100), { id: Math.random().toString(), time, stage, message, type }]);
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
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 3000);
  };

  const stopKeepAlive = () => {
    if (keepAliveInterval.current) {
      clearInterval(keepAliveInterval.current);
      keepAliveInterval.current = null;
    }
  };

  const startInteraction = async () => {
    try {
      setStatus("listening");
      setTranscript("");
      setAgentResponse("");
      setVadStateText("Connecting to Deepgram...");
      currentTurnProcessed.current = false;
      resetStages();
      addLog("DEEPGRAM", "Requesting token...", "info");
      
      // 1. Fetch token
      const res = await fetch("/api/deepgram-token");
      const data = await res.json();
      if (!data.key) {
        throw new Error(data.error || "Failed to retrieve Deepgram token");
      }
      const key = data.key;

      // 2. Open Persistent WebSocket
      const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&endpointing=350&interim_results=true&utterance_end_ms=1000`;
      ws.current = new WebSocket(wsUrl, ["token", key]);
      
      ws.current.onopen = async () => {
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
          if (isListeningActive.current && e.data && e.data.size > 0 && ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(e.data);
          }
        };

        isListeningActive.current = true;
        mediaRecorder.current.start(150);
        addLog("STT", "Live audio streaming to Deepgram active (150ms chunks)", "success");
      };

      ws.current.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Flux Turn Taking
          if (msg.type === "TurnInfo" && msg.eventType === "EndOfTurn") {
            const finalTranscript = msg.transcript?.trim();
            if (finalTranscript && !currentTurnProcessed.current && isListeningActive.current) {
              currentTurnProcessed.current = true;
              isListeningActive.current = false;
              startKeepAlive();
              t_user_silence_start.current = performance.now() - 150;
              const vadLatency = Math.max(0, performance.now() - t_user_silence_start.current);
              addLog("VAD", `Flux EndOfTurn detected (VAD: ${vadLatency.toFixed(0)}ms)`, "success");
              processTurn(finalTranscript, vadLatency);
            }
            return;
          }

          // Deepgram Live Transcript & Endpointing
          const alt = msg.channel?.alternatives?.[0];
          const text = alt?.transcript?.trim();

          if (text && isListeningActive.current) {
            setTranscript(text);
            setStageSTT((prev) => ({ ...prev, detail: text }));
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
          console.warn("Deepgram WS message parse error:", parseErr);
        }
      };

      ws.current.onerror = (err) => {
        console.error("Deepgram WebSocket Error:", err);
        addLog("DEEPGRAM", "WebSocket connection error", "error");
      };

      ws.current.onclose = () => {
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
    resetStages();
    setStatus("listening");
    setVadStateText("Listening... (Speak anytime)");
    setTranscript("");
    setAgentResponse("");
    addLog("MIC", "Mic active, ready for next turn (KeepAlive stopped)", "info");
  };

  const playNextAudio = () => {
    if (audioQueue.current.length === 0) {
      isPlaying.current = false;
      addLog("PLAYBACK", "Agent finished speaking", "info");

      if (continuousModeRef.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
        resumeListening();
      } else {
        setStatus("idle");
        setVadStateText("Idle");
      }
      return;
    }

    isPlaying.current = true;
    setStatus("playing");
    setVadStateText("Agent speaking (Audio streaming)...");
    const audio = audioQueue.current.shift()!;
    audio.onended = playNextAudio;
    audio.onerror = playNextAudio;
    audio.play().catch(() => playNextAudio());
  };

  const processTurn = async (userText: string, vadLatency: number) => {
    setStatus("processing");
    setVadStateText("Streaming Groq LLM & synthesizing chunks...");
    setStageVAD({ status: "completed", latency: vadLatency });
    setStageSTT({ status: "completed", latency: 0, detail: userText });
    setStageLLM({ status: "running" });
    setStageTTS({ status: "pending" });
    setStagePlayback({ status: "pending" });

    addLog("LLM", `Sent prompt to Groq (openai/gpt-oss-20b)${chatHistoryRef.current.length > 0 ? ` with ${Math.round(chatHistoryRef.current.length / 2)} turn(s) history` : ""}: "${userText}"`, "info");

    const turnData: Partial<TurnMetrics> = { 
      vadLatency, 
      sttLatency: 0,
      transcript: userText 
    };
    let t_audio_play = 0;
    let chunkCount = 0;

    try {
      const res = await fetch("/api/chat-optimized", {
        method: "POST",
        body: JSON.stringify({ 
          transcript: userText,
          history: chatHistoryRef.current
        }),
        headers: { "Content-Type": "application/json" }
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
              turnData.llmTTFT = data.time;
              setStageLLM((prev) => ({ ...prev, ttft: data.time, status: "running" }));
              addLog("LLM", `⚡ First token received from Groq (TTFT: ${data.time.toFixed(0)}ms)`, "success");
            }

            if (data.type === "ttfa") {
              turnData.ttsTTFA = data.time;
              setStageTTS((prev) => ({ ...prev, ttfa: data.time, status: "running" }));
              addLog("TTS", `⚡ First chunk TTS synthesized (TTFA: ${data.time.toFixed(0)}ms)`, "success");
            }

            if (data.type === "llm_done") {
              const completedText = data.fullResponse || fullResponse;
              turnData.llmTotal = data.time;
              turnData.response = completedText;
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

              addLog("LLM", `Groq LLM stream finished in ${data.time.toFixed(0)}ms`, "success");
            }
            
            if (data.type === "audio_chunk" && data.base64) {
              chunkCount += 1;
              fullResponse += (data.text ? data.text + " " : "");
              setAgentResponse(fullResponse);
              setStageTTS((prev) => ({ ...prev, status: "completed", detail: `${chunkCount} chunk(s)` }));
              addLog("TTS", `Audio chunk #${chunkCount} received: "${data.text?.slice(0, 30)}..."`, "info");
              
              const audio = new Audio(`data:audio/wav;base64,${data.base64}`);
              
              // Measure when the first audio sentence chunk begins hardware playback
              if (t_audio_play === 0) {
                audio.onplay = () => {
                  if (t_audio_play === 0) {
                    t_audio_play = performance.now();
                    const total = t_audio_play - t_user_silence_start.current;
                    turnData.totalLatency = total;
                    setStagePlayback({ status: "completed", latency: total });
                    addLog("PLAYBACK", `⚡ Total turn-to-audio latency: ${total.toFixed(0)}ms`, "success");
                    
                    setMetrics((prev) => [
                      ...prev,
                      {
                        turn: prev.length + 1,
                        vadLatency: turnData.vadLatency ?? 0,
                        sttLatency: turnData.sttLatency ?? 0,
                        llmTTFT: turnData.llmTTFT ?? 0,
                        llmTotal: turnData.llmTotal ?? 0,
                        ttsTTFA: turnData.ttsTTFA ?? 0,
                        llmTtft: turnData.llmTTFT ?? 0,
                        llmLatency: turnData.llmTotal ?? 0,
                        ttsLatency: turnData.ttsTTFA ?? 0,
                        totalLatency: total,
                        transcript: userText,
                        response: turnData.response || fullResponse || "Agent response"
                      }
                    ]);
                  }
                };
              }
              
              audioQueue.current.push(audio);
              if (!isPlaying.current) {
                setStagePlayback({ status: "running" });
                playNextAudio();
              }
            }
          } catch (e) {
            console.error("NDJSON chunk parse error:", e);
          }
        }
      }
    } catch (err: any) {
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
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
    }
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((t) => t.stop());
    }
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      ws.current.close();
    }
    audioQueue.current = [];
    isPlaying.current = false;
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
  const p50Total = calculatePercentile(totalLatencies, 50);
  const p95Total = calculatePercentile(totalLatencies, 95);
  const p50TTFT = calculatePercentile(ttftLatencies, 50);
  const p95TTFT = calculatePercentile(ttftLatencies, 95);

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
            <p className="text-slate-500">Deepgram Streaming STT (KeepAlive) → Groq LLM (openai/gpt-oss-20b) → Chunked Gemini TTS</p>
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
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer bg-white px-3 py-1.5 rounded-md border">
              <input
                type="checkbox"
                checked={continuousMode}
                onChange={(e) => setContinuousMode(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              Continuous Conversation
            </label>
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
                <CardDescription>Visual execution breakdown of the overlapping streaming voice pipeline</CardDescription>
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
                <p className="text-[10px] font-mono text-blue-600 font-medium truncate">Deepgram WebSocket</p>
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
                <p className="text-[10px] font-mono text-amber-600 font-medium truncate" title="Chunked Gemini TTS">
                  Chunked Gemini TTS
                </p>
                <div className="flex flex-col gap-0.5 mt-1">
                  {stageTTS.ttfa !== undefined && (
                    <span className="text-[11px] font-mono text-amber-700 font-semibold">
                      TTFA: {stageTTS.ttfa.toFixed(0)}ms
                    </span>
                  )}
                  {stageTTS.detail && (
                    <span className="text-[10px] font-mono text-slate-500">{stageTTS.detail}</span>
                  )}
                </div>
              </div>

              {/* Stage 5: Playback */}
              <div className={`p-3 rounded-lg border transition-all ${stagePlayback.status === 'running' ? 'border-emerald-400 bg-emerald-50/50' : stagePlayback.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">5. 🎧 Output</span>
                  {getStageBadge(stagePlayback, "Audio")}
                </div>
                <p className="text-[10px] font-mono text-slate-500">Audio Stream</p>
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
                <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">Agent Response (Groq LLM)</span>
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
                  Streaming LLM...
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
              <CardDescription>Overlapped streaming benchmarks (Deepgram STT + Groq TTFT + Gemini TTFA)</CardDescription>
            </div>
            <div className="flex gap-4 items-center">
              <div className="text-xs bg-slate-100 p-2 rounded border space-y-0.5">
                <div>
                  <span className="font-semibold text-slate-700">Total Latency:</span> p50: <span className="font-bold">{p50Total.toFixed(0)}ms</span> | p95: <span className="font-bold">{p95Total.toFixed(0)}ms</span>
                </div>
                <div>
                  <span className="font-semibold text-purple-700">Groq TTFT:</span> p50: <span className="font-bold text-purple-800">{p50TTFT.toFixed(0)}ms</span> | p95: <span className="font-bold text-purple-800">{p95TTFT.toFixed(0)}ms</span>
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
                  <TableHead className="text-amber-700 font-semibold">TTS TTFA (ms)</TableHead>
                  <TableHead className="text-right font-bold">Total (ms)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500 py-6">
                      No data yet. Click &apos;Start Speaking&apos; to test the optimized pipeline!
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
