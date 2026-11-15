import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, toClaudeMessages, type ChatMessage } from "@/lib/chatPrompt";

// Vercel stores the key as ANTHROPIC_KEY; the SDK's default name is ANTHROPIC_API_KEY.
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY,
});

// Searching and reading pages can take a while; give the function room to finish.
export const maxDuration = 120;

/**
 * Anthropic-hosted tools: they run on Anthropic's servers, so there is no tool
 * code here. These versions work with claude-sonnet-4-5. Caps keep cost bounded:
 * web search is billed per search; fetched pages count as input tokens.
 */
const WEB_TOOLS: Anthropic.ToolUnion[] = [
  { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5, max_content_tokens: 25000 },
];

/** A long server-tool turn can stop with pause_turn; we continue it at most this many times. */
const MAX_CONTINUATIONS = 4;

type Source = { url: string; title?: string };

/** Pages Claude searched, cited or fetched in a finished message, for the Sources list. */
function sourcesOf(message: Anthropic.Message): Source[] {
  const sources: Source[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") sources.push({ url: c.url, title: c.title ?? undefined });
      }
    } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
      sources.push({ url: block.content.url, title: block.content.content.title ?? undefined });
    }
  }
  return sources;
}

/**
 * Yields Claude's reply text as it streams. If a web search or fetch makes the
 * turn pause (stop_reason "pause_turn"), sends the partial turn back so Claude
 * continues, then ends with a Sources list of the pages it used.
 */
async function* replyText(
  system: string,
  messages: Anthropic.MessageParam[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const conversation = [...messages];
  const sources = new Map<string, Source>();

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = client.messages.stream(
      { model: "claude-sonnet-4-5", max_tokens: 8192, system, messages: conversation, tools: WEB_TOOLS },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    const message = await stream.finalMessage();
    for (const s of sourcesOf(message)) if (!sources.has(s.url)) sources.set(s.url, s);

    if (message.stop_reason !== "pause_turn") break;
    conversation.push({ role: "assistant", content: message.content });
  }

  if (sources.size > 0) {
    const list = [...sources.values()]
      .slice(0, 8)
      .map((s) => `- [${(s.title || s.url).replace(/[[\]]/g, "")}](${s.url})`)
      .join("\n");
    yield `\n\n**Sources**\n${list}`;
  }
}

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

  const chunks = replyText(
    // Tells Claude who is in the chat; each user message is labelled with its speaker.
    buildSystemPrompt(messages, memories),
    toClaudeMessages(messages),
    request.signal,
  );

  // Wait for the first text so setup errors can be returned with a real status code.
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (error) {
    console.error("Anthropic API error:", error);
    const status = error instanceof Anthropic.APIError && error.status ? error.status : 500;
    return Response.json({ error: String(error) }, { status });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(encoder.encode(first.value));
        for await (const text of chunks) controller.enqueue(encoder.encode(text));
        controller.close();
      } catch (error) {
        if (!request.signal.aborted) console.error("Anthropic stream error:", error);
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
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
