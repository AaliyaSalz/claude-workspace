import Anthropic from "@anthropic-ai/sdk";

// Vercel stores the key as ANTHROPIC_KEY; the SDK's default name is ANTHROPIC_API_KEY.
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY,
});

export async function POST(request: Request) {
  try {
    const { messages, memories } = await request.json();

    const systemPrompt = memories && memories.length > 0
      ? `You are a helpful assistant. Here are some things to remember about the user:\n${memories.map((m: string) => `- ${m}`).join("\n")}`
      : "You are a helpful assistant.";

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    return Response.json({
      message: response.content[0].type === "text" ? response.content[0].text : ""
    });

  } catch (error) {
    console.error("Anthropic API error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}