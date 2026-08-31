"use client";

import { useState, useRef, useEffect } from "react";
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
      const llmTtft = backendMetrics.llmTtft;
      const llmLatency = backendMetrics.llmLatency;
      const ttsLatency = backendMetrics.ttsLatency;

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
            llmTtft,
            llmLatency,
            ttsLatency,
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
              llmTtft,
              llmLatency,
              ttsLatency,
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
  const ttftLatencies = metrics.map((m) => m.llmTtft);
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

  const clearHistory = () => {
    setChatHistory([]);
    setLastInteractionId(null);
    addLog("APP", "Conversation history & session reset", "info");
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-900 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header & Controls */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Baseline Voice Agent</h1>
            <p className="text-slate-500 mt-1">Sequential STT → LLM → TTS pipeline with multi-turn memory & live TTFT</p>
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
        <Card className="border-blue-100 bg-white shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-base font-semibold text-slate-900">Live Pipeline Stage Tracker</CardTitle>
                <CardDescription>Visual execution breakdown of the sequential voice pipeline</CardDescription>
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
                <p className="text-[10px] font-mono text-slate-500">Web Audio RMS</p>
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
                <p className="text-[10px] font-mono text-blue-600 font-medium">gemini-3.5-transcribe</p>
                {stageSTT.latency !== undefined && (
                  <p className="text-xs font-mono font-medium text-emerald-700 mt-1">{stageSTT.latency.toFixed(0)}ms</p>
                )}
              </div>

              {/* Stage 3: LLM & TTFT */}
              <div className={`p-3 rounded-lg border transition-all ${stageLLM.status === 'running' ? 'border-blue-400 bg-blue-50/50' : stageLLM.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">3. 🧠 LLM</span>
                  {getStageBadge(stageLLM, "LLM")}
                </div>
                <p className="text-[10px] font-mono text-purple-600 font-medium">gemini-3.7-flash</p>
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
                <p className="text-[10px] font-mono text-amber-600 font-medium truncate" title="gemini-3.1-flash-tts-preview (Puck)">
                  gemini-3.1-flash-tts-preview
                </p>
                {stageTTS.latency !== undefined && (
                  <p className="text-xs font-mono font-medium text-emerald-700 mt-1">{stageTTS.latency.toFixed(0)}ms</p>
                )}
              </div>

              {/* Stage 5: Playback */}
              <div className={`p-3 rounded-lg border transition-all ${stagePlayback.status === 'running' ? 'border-emerald-400 bg-emerald-50/50' : stagePlayback.status === 'completed' ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-slate-700">5. 🎧 Output</span>
                  {getStageBadge(stagePlayback, "Audio")}
                </div>
                <p className="text-[10px] font-mono text-slate-500">Browser Playback</p>
                {stagePlayback.latency !== undefined && (
                  <p className="text-xs font-mono font-bold text-emerald-800 mt-1">Total: {stagePlayback.latency.toFixed(0)}ms</p>
                )}
              </div>

            </div>

            {/* Conversation Output Box */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-slate-50 rounded-md border text-xs">
                <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">User Transcript (STT)</span>
                <p className="text-slate-800 font-medium whitespace-pre-wrap">{stageSTT.detail || transcript || "Waiting for user speech..."}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-md border text-xs">
                <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">Agent Response (LLM)</span>
                <p className="text-slate-800 font-medium whitespace-pre-wrap">{agentResponse || "Waiting for LLM generation..."}</p>
              </div>
            </div>

            {/* Live Audio Level Meter & Controls */}
            {status === "listening" && (
              <div className="space-y-3 p-3 bg-slate-50 rounded-lg border">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs text-slate-600 font-medium">
                    <span>Mic Volume (RMS): <span className="font-semibold">{volumeLevel}</span></span>
                    <span className={isSpeakingState ? "text-emerald-600 font-bold" : "text-slate-500"}>
                      {isSpeakingState ? "● Speaking Active" : "Waiting for speech..."}
                    </span>
                  </div>
                  <div className="relative w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-75 ${
                        volumeLevel >= speechThreshold ? "bg-emerald-500" : "bg-blue-400"
                      }`}
                      style={{ width: `${Math.min(100, volumeLevel)}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                      style={{ left: `${speechThreshold}%` }}
                      title={`Speech Threshold: ${speechThreshold}`}
                    />
                  </div>
                </div>

                {silenceProgress > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px] text-amber-700 font-medium">
                      <span>Silence detection progress:</span>
                      <span>{silenceProgress}%</span>
                    </div>
                    <div className="w-full bg-amber-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-75"
                        style={{ width: `${silenceProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

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
                <>
                  <Button
                    onClick={manualSendNow}
                    size="lg"
                    className="w-40 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  >
                    Send Now
                  </Button>
                  <Button
                    onClick={endConversation}
                    variant="destructive"
                    size="lg"
                    className="w-40 cursor-pointer"
                  >
                    Stop
                  </Button>
                </>
              )}

              {status === "processing" && (
                <Button disabled size="lg" className="w-52 bg-slate-400 text-white">
                  Agent Thinking...
                </Button>
              )}

              {status === "playing" && (
                <Button
                  onClick={endConversation}
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
              <CardDescription>Precise benchmarks including LLM Time-To-First-Token (TTFT)</CardDescription>
            </div>
            <div className="flex gap-4 items-center">
              <div className="text-xs bg-slate-100 p-2 rounded border space-y-0.5">
                <div>
                  <span className="font-semibold text-slate-700">Total Latency:</span> p50: <span className="font-bold">{p50Total.toFixed(0)}ms</span> | p95: <span className="font-bold">{p95Total.toFixed(0)}ms</span>
                </div>
                <div>
                  <span className="font-semibold text-purple-700">LLM TTFT:</span> p50: <span className="font-bold text-purple-800">{p50TTFT.toFixed(0)}ms</span> | p95: <span className="font-bold text-purple-800">{p95TTFT.toFixed(0)}ms</span>
                </div>
              </div>
              <Button variant="outline" onClick={() => downloadCSV(metrics)} disabled={metrics.length === 0}>
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
                  <TableHead className="text-purple-700 font-semibold">LLM TTFT (ms)</TableHead>
                  <TableHead>LLM Total (ms)</TableHead>
                  <TableHead>TTS (ms)</TableHead>
                  <TableHead className="text-right font-bold">Total (ms)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500 py-6">
                      No data yet. Click &apos;Start Speaking&apos; to run turns!
                    </TableCell>
                  </TableRow>
                ) : (
                  metrics.map((m) => (
                    <TableRow key={m.turn}>
                      <TableCell className="font-medium">{m.turn}</TableCell>
                      <TableCell>{m.vadLatency.toFixed(0)}</TableCell>
                      <TableCell>{m.sttLatency.toFixed(0)}</TableCell>
                      <TableCell className="text-purple-700 font-semibold">{m.llmTtft.toFixed(0)}</TableCell>
                      <TableCell>{m.llmLatency.toFixed(0)}</TableCell>
                      <TableCell>{m.ttsLatency.toFixed(0)}</TableCell>
                      <TableCell className="text-right font-bold">{m.totalLatency.toFixed(0)}</TableCell>
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
              <span className="text-xs font-mono font-medium text-slate-300 ml-2">Pipeline Execution Logs</span>
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
                <div className="text-slate-500">Ready. Start an interaction to stream detailed logs...</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="flex gap-2 items-start leading-relaxed">
                    <span className="text-slate-500 select-none">[{l.time}]</span>
                    <span
                      className={`font-semibold px-1 py-0.2 rounded text-[10px] ${
                        l.stage === "STT" ? "bg-blue-950 text-blue-300" :
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
