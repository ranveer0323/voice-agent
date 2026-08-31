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
  detail?: string;
}

interface LogEntry {
  id: string;
  time: string;
  stage: string;
  message: string;
  type: "info" | "success" | "warn" | "error";
}

export default function BaselineAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [metrics, setMetrics] = useState<TurnMetrics[]>([]);
  const [transcript, setTranscript] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [isSpeakingState, setIsSpeakingState] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true);
  const [vadStateText, setVadStateText] = useState("Idle");
  const [silenceProgress, setSilenceProgress] = useState(0);
  const [speechThreshold, setSpeechThreshold] = useState(15);
  const [silenceDurationMs, setSilenceDurationMs] = useState(650);

  // Live Pipeline Stage Tracking
  const [stageVAD, setStageVAD] = useState<StageState>({ status: "idle" });
  const [stageSTT, setStageSTT] = useState<StageState>({ status: "idle" });
  const [stageLLM, setStageLLM] = useState<StageState>({ status: "idle" });
  const [stageTTS, setStageTTS] = useState<StageState>({ status: "idle" });
  const [stagePlayback, setStagePlayback] = useState<StageState>({ status: "idle" });

  // Multi-Turn Chat History
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const chatHistoryRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [lastInteractionId, setLastInteractionId] = useState<string | null>(null);
  const lastInteractionIdRef = useRef<string | null>(null);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    lastInteractionIdRef.current = lastInteractionId;
  }, [lastInteractionId]);

  // Execution Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  
  // Audio Refs
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const vadInterval = useRef<NodeJS.Timeout | null>(null);
  const audioChunks = useRef<BlobPart[]>([]);
  const mediaStream = useRef<MediaStream | null>(null);

  // Timing & VAD Refs
  const smoothedVolume = useRef<number>(0);
  const lastSpeechTime = useRef<number>(0);
  const isSpeaking = useRef<boolean>(false);
  const speechDetectedOnce = useRef<boolean>(false);
  const speechStartTime = useRef<number>(0);
  const consecutiveSpeechFrames = useRef<number>(0);
  const t_user_silence_start = useRef<number>(0);
  const continuousModeRef = useRef<boolean>(true);
  const speechThresholdRef = useRef<number>(15);
  const silenceDurationMsRef = useRef<number>(650);

  useEffect(() => {
    continuousModeRef.current = continuousMode;
  }, [continuousMode]);

  useEffect(() => {
    speechThresholdRef.current = speechThreshold;
  }, [speechThreshold]);

  useEffect(() => {
    silenceDurationMsRef.current = silenceDurationMs;
  }, [silenceDurationMs]);

  const addLog = (stage: string, message: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = `${now.toTimeString().split(" ")[0]}.${now.getMilliseconds().toString().padStart(3, "0")}`;
    setLogs((prev) => [...prev.slice(-100), { id: Math.random().toString(), time, stage, message, type }]);
  };

  const resetStages = () => {
    setStageVAD({ status: "running" });
    setStageSTT({ status: "pending" });
    setStageLLM({ status: "pending" });
    setStageTTS({ status: "pending" });
    setStagePlayback({ status: "pending" });
  };

  const startInteraction = async () => {
    try {
      if (mediaStream.current) {
        mediaStream.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStream.current = stream;
      setStatus("listening");
      setTranscript("Listening... Speak normally.");
      setAgentResponse("");
      setVadStateText("Listening (Speak anytime)...");
      setSilenceProgress(0);
      resetStages();
      addLog("MIC", "Microphone listening started", "info");

      // Reset state
      audioChunks.current = [];
      isSpeaking.current = false;
      speechDetectedOnce.current = false;
      consecutiveSpeechFrames.current = 0;
      smoothedVolume.current = 0;
      setIsSpeakingState(false);
      lastSpeechTime.current = performance.now();
      speechStartTime.current = 0;
      t_user_silence_start.current = 0;

      // Setup Web Audio VAD
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext.current = new AudioCtx();
      if (audioContext.current.state === "suspended") {
        await audioContext.current.resume();
      }

      const source = audioContext.current.createMediaStreamSource(stream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 1024;
      analyser.current.smoothingTimeConstant = 0.3;
      source.connect(analyser.current);

      const timeDomainData = new Float32Array(analyser.current.fftSize);

      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      mediaRecorder.current = new MediaRecorder(stream, { mimeType });
      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = async () => {
        if (mediaStream.current) {
          mediaStream.current.getTracks().forEach((track) => track.stop());
        }
        await processTurn();
      };

      mediaRecorder.current.start(100);

      // Stable RMS VAD Loop
      vadInterval.current = setInterval(() => {
        if (!analyser.current) return;
        analyser.current.getFloatTimeDomainData(timeDomainData);

        let sumSquares = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          sumSquares += timeDomainData[i] * timeDomainData[i];
        }
        const rms = Math.sqrt(sumSquares / timeDomainData.length);
        const rawVol = Math.min(100, Math.max(0, rms * 400));

        smoothedVolume.current = smoothedVolume.current * 0.7 + rawVol * 0.3;
        const currentVol = Math.round(smoothedVolume.current);
        setVolumeLevel(currentVol);

        const onThreshold = speechThresholdRef.current;
        const offThreshold = Math.max(2, onThreshold * 0.65);
        const SILENCE_TIMEOUT = silenceDurationMsRef.current;
        const now = performance.now();

        if (currentVol >= onThreshold) {
          consecutiveSpeechFrames.current += 1;

          if (consecutiveSpeechFrames.current >= 2) {
            if (!isSpeaking.current) {
              isSpeaking.current = true;
              speechDetectedOnce.current = true;
              speechStartTime.current = now;
              setIsSpeakingState(true);
              setVadStateText("Speech detected! Listening...");
              addLog("VAD", "Speech onset detected", "info");
            }
            lastSpeechTime.current = now;
            setSilenceProgress(0);
          }
        } else if (currentVol < offThreshold) {
          consecutiveSpeechFrames.current = 0;

          if (isSpeaking.current) {
            setIsSpeakingState(false);
            const silenceDuration = now - lastSpeechTime.current;
            const speechDuration = lastSpeechTime.current - speechStartTime.current;

            const progress = Math.min(100, Math.round((silenceDuration / SILENCE_TIMEOUT) * 100));
            setSilenceProgress(progress);

            if (silenceDuration >= SILENCE_TIMEOUT && speechDuration >= 300) {
              t_user_silence_start.current = lastSpeechTime.current;
              setVadStateText("End of turn detected — Sending to agent...");
              setSilenceProgress(100);
              addLog("VAD", `End of speech detected (silence duration: ${Math.round(silenceDuration)}ms)`, "success");
              stopListening();
            } else {
              setVadStateText(`Pause detected (${(silenceDuration / 1000).toFixed(1)}s / ${(SILENCE_TIMEOUT / 1000).toFixed(1)}s)...`);
            }
          } else {
            setSilenceProgress(0);
          }
        }
      }, 30);
    } catch (err: any) {
      console.error("Mic access error", err);
      setTranscript("Error: Microphone access denied or not found.");
      addLog("MIC", `Error: ${err.message || "Microphone access denied"}`, "error");
      setStatus("idle");
    }
  };

  const stopListening = () => {
    if (vadInterval.current) {
      clearInterval(vadInterval.current);
      vadInterval.current = null;
    }
    setVolumeLevel(0);
    setIsSpeakingState(false);
    setSilenceProgress(0);

    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      try {
        mediaRecorder.current.requestData();
      } catch {}
      mediaRecorder.current.stop();
    }
    if (audioContext.current && audioContext.current.state !== "closed") {
      audioContext.current.close().catch(() => {});
    }
  };

  const manualSendNow = () => {
    if (status === "listening") {
      t_user_silence_start.current = performance.now();
      setVadStateText("Manual send triggered...");
      addLog("VAD", "Manual send triggered by user", "info");
      stopListening();
    }
  };

  const processTurn = async () => {
    setStatus("processing");
    setVadStateText("Processing turn...");
    const t_vad_trigger = performance.now();
    const silenceStart = t_user_silence_start.current > 0 ? t_user_silence_start.current : t_vad_trigger - 500;
    const vadLatency = Math.max(0, t_vad_trigger - silenceStart);

    setStageVAD({ status: "completed", latency: vadLatency, detail: `${vadLatency.toFixed(0)}ms` });

    const audioBlob = new Blob(audioChunks.current, { type: "audio/webm" });
    if (audioBlob.size === 0) {
      setTranscript("No audio recorded. Click 'Start Speaking' to try again.");
      setStatus("idle");
      return;
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    if (lastInteractionIdRef.current) {
      formData.append("previous_interaction_id", lastInteractionIdRef.current);
    }

    try {
      addLog("PIPELINE", `Sending audio${lastInteractionIdRef.current ? ` (chained to interaction ${lastInteractionIdRef.current.slice(0, 8)}...)` : ""} to /api/chat-baseline`, "info");
      const res = await fetch("/api/chat-baseline", { method: "POST", body: formData });

      if (!res.ok || !res.body) {
        throw new Error(`Server responded with ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === "stt_start") {
              setStageSTT({ status: "running" });
              addLog("STT", "Speech-to-Text transcription started (gemini-3.5-transcribe)", "info");
            } else if (event.type === "stt_done") {
              setStageSTT({ status: "completed", latency: event.latency, detail: event.userText });
              setTranscript(`You: ${event.userText}`);
              addLog("STT", `STT complete in ${event.latency.toFixed(0)}ms: "${event.userText}"`, "success");
            } else if (event.type === "llm_start") {
              setStageLLM({ status: "running" });
              addLog("LLM", "Prompt sent to LLM (gemini-3.7-flash)", "info");
            } else if (event.type === "llm_first_token") {
              setStageLLM((prev) => ({ ...prev, ttft: event.ttft, status: "running" }));
              addLog("LLM", `⚡ First token received (TTFT: ${event.ttft.toFixed(0)}ms)`, "success");
            } else if (event.type === "llm_chunk") {
              setAgentResponse((prev) => prev + event.text);
            } else if (event.type === "llm_done") {
              setStageLLM({
                status: "completed",
                latency: event.latency,
                ttft: event.ttft,
                detail: event.agentText,
              });
              setAgentResponse(event.agentText);
              if (event.interactionId) {
                setLastInteractionId(event.interactionId);
              }
              addLog("LLM", `LLM complete in ${event.latency.toFixed(0)}ms (TTFT: ${event.ttft.toFixed(0)}ms)`, "success");
            } else if (event.type === "tts_start") {
              setStageTTS({ status: "running" });
              addLog("TTS", "Text-to-Speech synthesis started (gemini-3.1-flash-tts-preview)", "info");
            } else if (event.type === "tts_done") {
              setStageTTS({ status: "completed", latency: event.latency });
              addLog("TTS", `TTS synthesis complete in ${event.latency.toFixed(0)}ms`, "success");
            } else if (event.type === "turn_complete") {
              finalPayload = event;
              if (event.interactionId) {
                setLastInteractionId(event.interactionId);
              }
            } else if (event.type === "error") {
              throw new Error(event.error);
            }
          } catch (e: any) {
            console.error("Stream parse error:", e);
          }
        }
      }

      if (!finalPayload) {
        throw new Error("Pipeline ended without complete payload");
      }

      const { userText, agentText, audioBase64, mimeType, backendMetrics } = finalPayload;
      const sttLatency = backendMetrics.sttLatency;
      const llmTTFT = backendMetrics.llmTtft;
      const llmTotal = backendMetrics.llmLatency;
      const ttsTTFA = backendMetrics.ttsLatency;

      // Update conversation history
      if (userText && agentText) {
        setChatHistory((prev) => [
          ...prev,
          { role: "user", content: userText },
          { role: "assistant", content: agentText },
        ]);
      }

      if (!audioBase64) {
        const totalLatency = performance.now() - silenceStart;
        setMetrics((prev) => [
          ...prev,
          {
            turn: prev.length + 1,
            vadLatency,
            sttLatency,
            llmTTFT,
            llmTotal,
            ttsTTFA,
            llmTtft: llmTTFT,
            llmLatency: llmTotal,
            ttsLatency: ttsTTFA,
            totalLatency,
            transcript: userText || "N/A",
            response: agentText || "N/A",
          },
        ]);
        setStatus("idle");
        if (continuousModeRef.current) {
          setTimeout(() => startInteraction(), 600);
        }
        return;
      }

      // Audio Playback
      setStatus("playing");
      setStagePlayback({ status: "running" });
      setVadStateText("Agent speaking...");
      addLog("PLAYBACK", "Starting audio playback", "info");

      const finalMime = mimeType || "audio/wav";
      const audio = new Audio(`data:${finalMime};base64,${audioBase64}`);

      let measured = false;
      const recordMetrics = () => {
        if (!measured) {
          measured = true;
          const t_audio_play = performance.now();
          const totalLatency = t_audio_play - silenceStart;
          setStagePlayback({ status: "completed", latency: totalLatency });

          setMetrics((prev) => [
            ...prev,
            {
              turn: prev.length + 1,
              vadLatency,
              sttLatency,
              llmTTFT,
              llmTotal,
              ttsTTFA,
              llmTtft: llmTTFT,
              llmLatency: llmTotal,
              ttsLatency: ttsTTFA,
              totalLatency,
              transcript: userText,
              response: agentText,
            },
          ]);
          addLog("METRICS", `Turn total latency: ${totalLatency.toFixed(0)}ms (Playback started)`, "success");
        }
      };

      audio.onplay = () => {
        recordMetrics();
      };

      audio.onerror = (e) => {
        console.error("Audio playback error", e);
        recordMetrics();
        setStagePlayback({ status: "error" });
        addLog("PLAYBACK", "Audio playback error occurred", "error");
        setStatus("idle");
        if (continuousModeRef.current) {
          setTimeout(() => startInteraction(), 1000);
        }
      };

      audio.onended = () => {
        setStatus("idle");
        addLog("PLAYBACK", "Agent finished speaking", "info");
        if (continuousModeRef.current) {
          setTimeout(() => startInteraction(), 400);
        }
      };

      try {
        await audio.play();
      } catch (playErr) {
        console.warn("Autoplay audio error:", playErr);
        recordMetrics();
        setStatus("idle");
        if (continuousModeRef.current) {
          setTimeout(() => startInteraction(), 1000);
        }
      }
    } catch (error: any) {
      console.error(error);
      setTranscript(`Error: ${error.message || "Failed to process voice turn."}`);
      addLog("ERROR", error.message || "Pipeline failure", "error");
      setStatus("idle");
    }
  };

  const endConversation = () => {
    stopListening();
    setStatus("idle");
    setVadStateText("Idle");
    setSilenceProgress(0);
    addLog("APP", "Conversation stopped by user", "info");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadInterval.current) clearInterval(vadInterval.current);
      if (mediaStream.current) mediaStream.current.getTracks().forEach((t) => t.stop());
      if (audioContext.current && audioContext.current.state !== "closed") {
        audioContext.current.close().catch(() => {});
      }
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
        return <Badge variant="outline" className="border-zinc-200 text-zinc-400 font-mono text-[10px]">Waiting</Badge>;
      case "pending":
        return <Badge variant="outline" className="border-zinc-200 text-zinc-400 font-mono text-[10px]">Pending</Badge>;
      case "running":
        return <Badge className="bg-black text-white font-mono text-[10px] animate-pulse">Running...</Badge>;
      case "completed":
        return (
          <Badge className="bg-zinc-100 text-zinc-900 border border-zinc-300 font-mono text-[10px] flex gap-1 items-center">
            <span>✓</span>
            <span>{stage.latency !== undefined ? `${stage.latency.toFixed(0)}ms` : "Done"}</span>
          </Badge>
        );
      case "error":
        return <Badge variant="destructive" className="font-mono text-[10px]">Failed</Badge>;
      default:
        return <Badge variant="secondary" className="font-mono text-[10px]">{defaultLabel}</Badge>;
    }
  };

  const clearHistory = () => {
    setChatHistory([]);
    setLastInteractionId(null);
    addLog("APP", "Conversation history & session reset", "info");
  };

  return (
    <div className="min-h-screen bg-white text-black font-sans selection:bg-black selection:text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <Link href="/">
                <Button variant="outline" size="sm" className="h-8 text-xs border-zinc-300 hover:bg-zinc-100 text-zinc-900 cursor-pointer">
                  ← Back to Benchmark
                </Button>
              </Link>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-black">Baseline Voice Agent</h1>
            </div>
            <p className="text-zinc-600 text-xs sm:text-sm">Sequential STT → LLM → TTS pipeline with Google Gemini models</p>
          </div>
          <div className="flex items-center gap-2.5">
            {chatHistory.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearHistory}
                className="text-xs h-8 border-zinc-300 text-zinc-700 hover:bg-zinc-100 cursor-pointer bg-white"
              >
                Clear History ({Math.round(chatHistory.length / 2)} turns)
              </Button>
            )}
            <Badge
              variant="outline"
              className={`px-3 py-1 font-mono text-xs uppercase tracking-wider ${
                status === "listening" ? "bg-black text-white border-black animate-pulse" :
                status === "processing" ? "bg-zinc-800 text-white border-zinc-800" :
                status === "playing" ? "bg-zinc-100 text-black border-zinc-400 font-bold" :
                "bg-zinc-50 text-zinc-600 border-zinc-300"
              }`}
            >
              {status}
            </Badge>
          </div>
        </div>

        {/* Live Pipeline Lifecycle Tracker Card */}
        <Card className="border border-zinc-200 bg-white shadow-none">
          <CardHeader className="pb-3 border-b border-zinc-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-bold text-black">Pipeline Stage Tracker</CardTitle>
                <CardDescription className="text-zinc-500 text-xs">Visual execution breakdown of the sequential voice pipeline</CardDescription>
              </div>
              <div className="text-xs text-zinc-600 font-mono bg-zinc-100 border border-zinc-200 px-2.5 py-1 rounded">
                Status: <span className="font-semibold text-black">{vadStateText}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              
              {/* Stage 1: VAD */}
              <div className={`p-3 rounded-lg border transition-all ${stageVAD.status === 'running' ? 'border-black bg-zinc-50' : stageVAD.status === 'completed' ? 'border-zinc-300 bg-zinc-50/70' : 'border-zinc-200 bg-white'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-black">1. VAD</span>
                  {getStageBadge(stageVAD, "VAD")}
                </div>
                <p className="text-[10px] font-mono text-zinc-500">Browser RMS</p>
                {stageVAD.latency !== undefined && (
                  <p className="text-xs font-mono font-bold text-black mt-1">{stageVAD.latency.toFixed(0)}ms</p>
                )}
              </div>

              {/* Stage 2: STT */}
              <div className={`p-3 rounded-lg border transition-all ${stageSTT.status === 'running' ? 'border-black bg-zinc-50' : stageSTT.status === 'completed' ? 'border-zinc-300 bg-zinc-50/70' : 'border-zinc-200 bg-white'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-black">2. STT</span>
                  {getStageBadge(stageSTT, "STT")}
                </div>
                <p className="text-[10px] font-mono text-zinc-600 truncate" title="gemini-3.5-transcribe">gemini-3.5-transcribe</p>
                {stageSTT.latency !== undefined && (
                  <p className="text-xs font-mono font-bold text-black mt-1">{stageSTT.latency.toFixed(0)}ms</p>
                )}
              </div>

              {/* Stage 3: LLM & TTFT */}
              <div className={`p-3 rounded-lg border transition-all ${stageLLM.status === 'running' ? 'border-black bg-zinc-50' : stageLLM.status === 'completed' ? 'border-zinc-300 bg-zinc-50/70' : 'border-zinc-200 bg-white'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-black">3. LLM</span>
                  {getStageBadge(stageLLM, "LLM")}
                </div>
                <p className="text-[10px] font-mono text-zinc-600 truncate" title="gemini-3.7-flash">gemini-3.7-flash</p>
                <div className="flex flex-col gap-0.5 mt-1">
                  {stageLLM.ttft !== undefined && (
                    <span className="text-[10px] font-mono text-zinc-600 font-semibold">
                      TTFT: {stageLLM.ttft.toFixed(0)}ms
                    </span>
                  )}
                  {stageLLM.latency !== undefined && (
                    <span className="text-xs font-mono font-bold text-black">
                      Total: {stageLLM.latency.toFixed(0)}ms
                    </span>
                  )}
                </div>
              </div>

              {/* Stage 4: TTS */}
              <div className={`p-3 rounded-lg border transition-all ${stageTTS.status === 'running' ? 'border-black bg-zinc-50' : stageTTS.status === 'completed' ? 'border-zinc-300 bg-zinc-50/70' : 'border-zinc-200 bg-white'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-black">4. TTS</span>
                  {getStageBadge(stageTTS, "TTS")}
                </div>
                <p className="text-[10px] font-mono text-zinc-600 truncate" title="gemini-3.1-flash-tts-preview">
                  gemini-3.1-flash-tts
                </p>
                {stageTTS.latency !== undefined && (
                  <p className="text-xs font-mono font-bold text-black mt-1">{stageTTS.latency.toFixed(0)}ms</p>
                )}
              </div>

              {/* Stage 5: Playback */}
              <div className={`p-3 rounded-lg border transition-all ${stagePlayback.status === 'running' ? 'border-black bg-zinc-50' : stagePlayback.status === 'completed' ? 'border-zinc-300 bg-zinc-50/70' : 'border-zinc-200 bg-white'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-black">5. Audio</span>
                  {getStageBadge(stagePlayback, "Audio")}
                </div>
                <p className="text-[10px] font-mono text-zinc-500">Browser Playback</p>
                {stagePlayback.latency !== undefined && (
                  <p className="text-xs font-mono font-black text-black mt-1">Total: {stagePlayback.latency.toFixed(0)}ms</p>
                )}
              </div>

            </div>

            {/* Conversation Output Box */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-xs">
                <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block mb-1">User Transcript (STT)</span>
                <p className="text-zinc-900 font-medium whitespace-pre-wrap">{stageSTT.detail || transcript || "Waiting for user speech..."}</p>
              </div>
              <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-xs">
                <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block mb-1">Agent Response (LLM)</span>
                <p className="text-zinc-900 font-medium whitespace-pre-wrap">{agentResponse || "Waiting for LLM generation..."}</p>
              </div>
            </div>

            {/* Live Audio Level Meter & Controls */}
            {status === "listening" && (
              <div className="space-y-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs text-zinc-700 font-medium">
                    <span>Mic Volume (RMS): <span className="font-mono font-bold">{volumeLevel}</span></span>
                    <span className={isSpeakingState ? "text-black font-bold" : "text-zinc-500"}>
                      {isSpeakingState ? "● Speaking Detected" : "Listening..."}
                    </span>
                  </div>
                  <div className="relative w-full bg-zinc-200 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-black transition-all duration-75"
                      style={{ width: `${Math.min(100, volumeLevel)}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-zinc-600"
                      style={{ left: `${speechThreshold}%` }}
                      title={`Speech Threshold: ${speechThreshold}`}
                    />
                  </div>
                </div>

                {silenceProgress > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px] text-zinc-600 font-medium">
                      <span>Silence detection progress:</span>
                      <span className="font-mono">{silenceProgress}%</span>
                    </div>
                    <div className="w-full bg-zinc-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-zinc-700 transition-all duration-75"
                        style={{ width: `${silenceProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-center gap-3 pt-1">
              {status === "idle" && (
                <Button
                  onClick={startInteraction}
                  size="lg"
                  className="w-48 bg-black hover:bg-zinc-800 text-white cursor-pointer font-semibold h-11"
                >
                  Start Speaking
                </Button>
              )}

              {status === "listening" && (
                <>
                  <Button
                    onClick={manualSendNow}
                    size="lg"
                    className="w-36 bg-black hover:bg-zinc-800 text-white cursor-pointer h-11"
                  >
                    Send Now
                  </Button>
                  <Button
                    onClick={endConversation}
                    variant="outline"
                    size="lg"
                    className="w-36 border-zinc-300 text-zinc-900 hover:bg-zinc-100 cursor-pointer h-11"
                  >
                    Stop
                  </Button>
                </>
              )}

              {status === "processing" && (
                <Button disabled size="lg" className="w-48 bg-zinc-200 text-zinc-600 h-11 font-medium">
                  Agent Thinking...
                </Button>
              )}

              {status === "playing" && (
                <Button
                  onClick={endConversation}
                  variant="outline"
                  size="lg"
                  className="w-48 border-zinc-400 text-black hover:bg-zinc-100 cursor-pointer h-11 font-medium"
                >
                  Agent Speaking (Stop)
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Metrics Dashboard */}
        <Card className="border border-zinc-200 bg-white shadow-none">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100">
            <div>
              <CardTitle className="text-base font-bold text-black">Turn Latency Measurements</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">Empirical benchmarks including LLM Time-To-First-Token (TTFT)</CardDescription>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="text-xs bg-zinc-50 p-2 rounded border border-zinc-200 space-y-0.5 font-mono">
                <div>
                  <span className="text-zinc-500">Total Latency:</span> p50: <span className="font-bold text-black">{p50Total.toFixed(0)}ms</span> | p95: <span className="font-bold text-black">{p95Total.toFixed(0)}ms</span>
                </div>
                <div>
                  <span className="text-zinc-500">LLM TTFT:</span> p50: <span className="font-bold text-black">{p50TTFT.toFixed(0)}ms</span> | p95: <span className="font-bold text-black">{p95TTFT.toFixed(0)}ms</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCSV(metrics, "baseline_metrics.csv")}
                disabled={metrics.length === 0}
                className="text-xs border-zinc-300 text-zinc-800 hover:bg-zinc-100 cursor-pointer"
              >
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="rounded border border-zinc-200 overflow-hidden">
              <Table>
                <TableHeader className="bg-zinc-50 border-b border-zinc-200">
                  <TableRow className="border-zinc-200">
                    <TableHead className="font-mono text-xs text-zinc-700">Turn</TableHead>
                    <TableHead className="font-mono text-xs text-zinc-700 text-right">VAD (ms)</TableHead>
                    <TableHead className="font-mono text-xs text-zinc-700 text-right">STT (ms)</TableHead>
                    <TableHead className="font-mono text-xs text-zinc-700 text-right">LLM TTFT</TableHead>
                    <TableHead className="font-mono text-xs text-zinc-700 text-right">LLM Total</TableHead>
                    <TableHead className="font-mono text-xs text-zinc-700 text-right">TTS (ms)</TableHead>
                    <TableHead className="font-mono text-xs text-black font-bold text-right">Total (ms)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-zinc-400 py-6 text-xs font-mono">
                        No turns recorded yet. Click &apos;Start Speaking&apos; to run an interaction.
                      </TableCell>
                    </TableRow>
                  ) : (
                    metrics.map((m) => (
                      <TableRow key={m.turn} className="border-zinc-200 hover:bg-zinc-50 text-xs">
                        <TableCell className="font-mono font-bold text-zinc-900">#{m.turn}</TableCell>
                        <TableCell className="font-mono text-right text-zinc-600">{(m.vadLatency ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="font-mono text-right text-zinc-600">{(m.sttLatency ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="font-mono text-right font-medium text-black">{(m.llmTTFT ?? m.llmTtft ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="font-mono text-right text-zinc-600">{(m.llmTotal ?? m.llmLatency ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="font-mono text-right text-zinc-600">{(m.ttsTTFA ?? m.ttsLatency ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="font-mono text-right font-bold text-black">{(m.totalLatency ?? 0).toFixed(0)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Execution Log Terminal */}
        <Card className="border border-zinc-200 bg-zinc-950 text-zinc-100 shadow-none">
          <CardHeader className="py-2.5 px-4 border-b border-zinc-800 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 inline-block" />
              <span className="text-xs font-mono font-medium text-zinc-400 ml-2">Pipeline Logs Console</span>
            </div>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="text-xs text-zinc-400 hover:text-white cursor-pointer font-mono"
            >
              {showLogs ? "Hide" : "Show"}
            </button>
          </CardHeader>
          {showLogs && (
            <CardContent className="p-3 font-mono text-[11px] max-h-44 overflow-y-auto space-y-1 bg-black">
              {logs.length === 0 ? (
                <div className="text-zinc-500">Ready. Start an interaction to stream pipeline logs...</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="flex gap-2 items-start leading-relaxed">
                    <span className="text-zinc-500 select-none">[{l.time}]</span>
                    <span className="font-semibold px-1 py-0.2 rounded text-[10px] bg-zinc-800 text-zinc-200">
                      {l.stage}
                    </span>
                    <span className={l.type === "error" ? "text-red-400 font-semibold" : l.type === "warn" ? "text-amber-300" : "text-zinc-300"}>
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
