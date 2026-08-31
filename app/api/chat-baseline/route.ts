import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import os from "os";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function pcmToWav(pcmData: Buffer, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;
  const header = Buffer.alloc(44);

  // RIFF identifier
  header.write("RIFF", 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write("WAVE", 8);
  // fmt subchunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size for PCM
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  // data subchunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export async function POST(request: Request) {
  let tmpFilePath = "";

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    if (!audioFile) return NextResponse.json({ error: "No audio file" }, { status: 400 });

    const previousInteractionId = (formData.get("previous_interaction_id") as string) || undefined;

    // 1. Save audio buffer to /tmp
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    tmpFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.webm`);
    await fs.writeFile(tmpFilePath, buffer);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        };

        try {
          // --- STEP 1: STT (Speech-to-Text) ---
          send({ type: "stt_start", timestamp: performance.now() });
          const t_stt_req = performance.now();
          const uploadResult = await ai.files.upload({
            file: tmpFilePath,
            config: { mimeType: "audio/webm" },
          });
          const sttInteraction = await (ai as any).interactions.create({
            model: "gemini-3.5-transcribe",
            input: [{ type: "audio", uri: uploadResult.uri, mime_type: "audio/webm" }],
          });
          const t_stt_res = performance.now();
          const userText = (sttInteraction as any).output_text || "No speech detected.";
          const sttLatency = t_stt_res - t_stt_req;
          send({ type: "stt_done", userText, latency: sttLatency });

          // --- STEP 2: LLM (with system_instruction & previous_interaction_id) ---
          send({ type: "llm_start", timestamp: performance.now() });
          const t_llm_req = performance.now();
          let t_first_token = 0;
          let agentText = "";
          let interactionId = "";

          const systemInstruction = "You are a helpful, concise voice assistant. Reply in 1-2 short sentences (under 25 words). Keep responses natural, conversational, and direct for spoken audio.";

          try {
            const llmStream = await (ai as any).interactions.create({
              model: "gemini-3.7-flash",
              system_instruction: systemInstruction,
              input: userText,
              previous_interaction_id: previousInteractionId,
              stream: true,
            });

            for await (const event of llmStream) {
              if (event.interaction?.id) {
                interactionId = event.interaction.id;
              }

              if (!t_first_token) {
                t_first_token = performance.now();
                send({ type: "llm_first_token", ttft: t_first_token - t_llm_req });
              }

              if (event.event === "step_delta" && event.data?.delta?.content) {
                for (const c of event.data.delta.content) {
                  if (c.type === "text" && c.text) {
                    agentText += c.text;
                    send({ type: "llm_chunk", text: c.text });
                  }
                }
              } else if (event.event_type === "step.delta" && event.delta?.type === "text") {
                agentText += event.delta.text;
                send({ type: "llm_chunk", text: event.delta.text });
              } else if ((event as any).output_text) {
                agentText = (event as any).output_text;
              } else if ((event as any).data?.interaction?.output_text) {
                agentText = (event as any).data.interaction.output_text;
              }
            }
          } catch (streamErr) {
            console.warn("LLM stream error, falling back:", streamErr);
          }

          if (!agentText) {
            const fallback = await (ai as any).interactions.create({
              model: "gemini-3.7-flash",
              system_instruction: systemInstruction,
              input: userText,
              previous_interaction_id: previousInteractionId,
            });
            agentText = (fallback as any).output_text || "I'm sorry, I didn't catch that.";
            interactionId = (fallback as any).id || interactionId;
            if (!t_first_token) t_first_token = performance.now();
          }

          const t_llm_res = performance.now();
          const llmTtft = t_first_token > 0 ? (t_first_token - t_llm_req) : (t_llm_res - t_llm_req);
          const llmLatency = t_llm_res - t_llm_req;
          send({ type: "llm_done", agentText, ttft: llmTtft, latency: llmLatency, interactionId });

          // --- STEP 3: TTS (Text-to-Speech) ---
          send({ type: "tts_start", timestamp: performance.now() });
          const t_tts_req = performance.now();
          const ttsInteraction = await (ai as any).interactions.create({
            model: "gemini-3.1-flash-tts-preview",
            input: agentText,
            response_format: { type: "audio" },
            generation_config: {
              speech_config: [{ voice: "Puck" }],
            },
          });
          const t_tts_res = performance.now();
          const ttsLatency = t_tts_res - t_tts_req;

          const outputAudio = (ttsInteraction as any).output_audio;
          let audioBase64 = outputAudio?.data;
          let mimeType = outputAudio?.mime_type || "audio/wav";

          if (audioBase64) {
            const rawAudioBuffer = Buffer.from(audioBase64, "base64");
            const isRiff = rawAudioBuffer.subarray(0, 4).toString() === "RIFF";
            const isMp3 = rawAudioBuffer.subarray(0, 3).toString() === "ID3" || (rawAudioBuffer[0] === 0xff && (rawAudioBuffer[1] & 0xe0) === 0xe0);

            if (isRiff) {
              mimeType = "audio/wav";
            } else if (isMp3) {
              mimeType = "audio/mp3";
            } else {
              const sampleRate = outputAudio?.sample_rate || 24000;
              const channels = outputAudio?.channels || 1;
              const wavBuffer = pcmToWav(rawAudioBuffer, sampleRate, channels, 16);
              audioBase64 = wavBuffer.toString("base64");
              mimeType = "audio/wav";
            }
          }

          send({ type: "tts_done", latency: ttsLatency });

          // --- TURN COMPLETE ---
          send({
            type: "turn_complete",
            userText,
            agentText,
            audioBase64,
            mimeType,
            interactionId,
            backendMetrics: {
              t_stt_req,
              t_stt_res,
              t_llm_req,
              t_llm_res,
              t_first_token,
              t_tts_req,
              t_tts_res,
              sttLatency,
              llmTtft,
              llmLatency,
              ttsLatency,
            }
          });

          controller.close();
        } catch (error: any) {
          console.error("Pipeline Stream Error:", error);
          send({ type: "error", error: error.message || "Internal error in voice pipeline" });
          controller.close();
        } finally {
          if (tmpFilePath) await fs.unlink(tmpFilePath).catch(() => {});
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });

  } catch (error: any) {
    console.error("Route Error:", error);
    if (tmpFilePath) await fs.unlink(tmpFilePath).catch(() => {});
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
