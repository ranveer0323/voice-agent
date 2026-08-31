import { NextRequest, NextResponse } from "next/server";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

          let fullResponse = "";

          for await (const chunk of chatCompletion) {
            if (t_llm_first_token === 0) {
              t_llm_first_token = performance.now();
              encode({ type: "ttft", time: t_llm_first_token - t_llm_req });
            }

            const delta = chunk.choices[0]?.delta?.content || "";
            if (delta) {
              fullResponse += delta;
              encode({ type: "token", text: delta });
            }
          }

          encode({
            type: "llm_done",
            time: performance.now() - t_llm_req,
            fullResponse: fullResponse.trim()
          });

          controller.close();
        } catch (e: any) {
          console.error("Optimized Groq Stream Error:", e);
          encode({ type: "error", error: e?.message || "LLM stream error" });
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

