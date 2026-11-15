import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, toClaudeMessages, type ChatMessage } from "@/lib/chatPrompt";

// Vercel stores the key as ANTHROPIC_KEY; the SDK's default name is ANTHROPIC_API_KEY.
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY,
});

/**
 * Streams Claude's reply as plain UTF-8 text chunks.
 *
 * - Errors that happen before any text is produced (bad key, rate limit, bad
 *   request) come back as a normal JSON `{ error }` response with a status code.
 * - Errors after streaming has started abort the stream, which the client sees
 *   as a failed read.
 * - If the browser aborts the request (Stop button), the upstream Claude call is
 *   cancelled too, so no more tokens are billed.
 */
export async function POST(request: Request) {
  const { messages, memories } = (await request.json()) as {
    messages: ChatMessage[];
    memories?: string[];
  };

  const stream = client.messages.stream(
    {
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      // Tells Claude who is in the chat; each user message is labelled with its speaker.
      system: buildSystemPrompt(messages, memories),
      messages: toClaudeMessages(messages),
    },
    { signal: request.signal },
  );

  // Wait for the first text so setup errors can be returned with a real status code.
  const events = stream[Symbol.asyncIterator]();
  let firstText = "";
  try {
    while (!firstText) {
      const { value: event, done } = await events.next();
      if (done) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        firstText = event.delta.text;
      }
    }
  } catch (error) {
    console.error("Anthropic API error:", error);
    const status = error instanceof Anthropic.APIError && error.status ? error.status : 500;
    return Response.json({ error: String(error) }, { status });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (firstText) controller.enqueue(encoder.encode(firstText));
        while (true) {
          const { value: event, done } = await events.next();
          if (done) break;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (error) {
        if (!request.signal.aborted) console.error("Anthropic stream error:", error);
        controller.error(error);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
