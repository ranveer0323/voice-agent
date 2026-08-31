import { NextResponse } from "next/server";

export async function GET() {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "DEEPGRAM_API_KEY is not configured" }, { status: 500 });
    }

    // Return the API key for direct browser WebSocket authentication
    return NextResponse.json({ key: apiKey });
  } catch (error: any) {
    console.error("Deepgram token error:", error);
    return NextResponse.json({ error: error?.message || "Failed to generate token" }, { status: 500 });
  }
}
