import { NextRequest, NextResponse } from "next/server";
import { Groq } from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

async function synthesizeTextToAudio(text: string): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;
  try {
    const ttsInteraction = await (gemini as any).interactions.create({
      model: "gemini-3.1-flash-tts-preview",
      input: text.trim(),
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Puck" }] },
    });

    const outputAudio = (ttsInteraction as any).output_audio;
    let audioBase64 = outputAudio?.data;
    if (!audioBase64) return null;

    const rawBuffer = Buffer.from(audioBase64, "base64");
    const isRiff = rawBuffer.subarray(0, 4).toString() === "RIFF";
    const isMp3 = rawBuffer.subarray(0, 3).toString() === "ID3" || (rawBuffer[0] === 0xff && (rawBuffer[1] & 0xe0) === 0xe0);

    if (isRiff || isMp3) {
      return audioBase64;
    }

    const sampleRate = outputAudio?.sample_rate || 24000;
    const channels = outputAudio?.channels || 1;
    const wavBuffer = pcmToWav(rawBuffer, sampleRate, channels, 16);
    return wavBuffer.toString("base64");
  } catch (err) {
    console.error("TTS Synthesis Error for text:", text, err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { transcript, history = [] } = await req.json();

    const stream = new ReadableStream({
      async start(controller) {
        const encode = (data: any) => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + "\n"));
        };

        const t_llm_req = performance.now();
        let t_llm_first_token = 0;
        let t_tts_req_first = 0;

        try {
          const formattedHistory = Array.isArray(history)
            ? history
                .filter((h: any) => h && h.content)
                .map((h: any) => ({
                  role: h.role === "assistant" ? ("assistant" as const) : ("user" as const),
                  content: String(h.content),
                }))
            : [];

          const chatCompletion = await groq.chat.completions.create({
            messages: [
              { role: "system", content: "You are a concise voice assistant. Reply in 1-2 short sentences (under 25 words)." },
              ...formattedHistory,
              { role: "user", content: transcript || "" }
            ],
            model: "openai/gpt-oss-20b",
            stream: true,
          });

          let sentenceBuffer = "";
          let isFirstSentence = true;
          let fullResponse = "";

          for await (const chunk of chatCompletion) {
            if (t_llm_first_token === 0) {
              t_llm_first_token = performance.now();
              encode({ type: "ttft", time: t_llm_first_token - t_llm_req });
            }

            const delta = chunk.choices[0]?.delta?.content || "";
            sentenceBuffer += delta;
            fullResponse += delta;

            // Sentence Boundary Detection
            if (/[.!?]\s/.test(sentenceBuffer)) {
              const match = sentenceBuffer.match(/^([\s\S]*?[.!?])\s+([\s\S]*)$/);
              let sentenceToSpeak = sentenceBuffer.trim();
              if (match) {
                sentenceToSpeak = match[1].trim();
                sentenceBuffer = match[2];
              } else {
                sentenceBuffer = "";
              }

              if (sentenceToSpeak.length > 0) {
                if (isFirstSentence) t_tts_req_first = performance.now();

                const audioBase64 = await synthesizeTextToAudio(sentenceToSpeak);

                if (isFirstSentence) {
                  encode({ type: "ttfa", time: performance.now() - t_tts_req_first });
                  isFirstSentence = false;
                }

                if (audioBase64) {
                  encode({ type: "audio_chunk", base64: audioBase64, text: sentenceToSpeak });
                }
              }
            }
          }

          // Catch any remaining text in the buffer
          if (sentenceBuffer.trim().length > 0) {
            const remainingText = sentenceBuffer.trim();
            if (isFirstSentence) t_tts_req_first = performance.now();

            const audioBase64 = await synthesizeTextToAudio(remainingText);

            if (isFirstSentence) {
              encode({ type: "ttfa", time: performance.now() - t_tts_req_first });
              isFirstSentence = false;
            }

            if (audioBase64) {
              encode({ type: "audio_chunk", base64: audioBase64, text: remainingText });
            }
          }

          encode({
            type: "llm_done",
            time: performance.now() - t_llm_req,
            fullResponse: fullResponse.trim()
          });

          controller.close();
        } catch (e: any) {
          console.error("Optimized Chat Pipeline Error:", e);
          encode({ type: "error", error: e?.message || "Pipeline error" });
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked"
      },
    });
  } catch (error: any) {
    console.error("Chat Optimized API Error:", error);
    return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
  }
}
