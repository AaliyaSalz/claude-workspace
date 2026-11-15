import type Anthropic from "@anthropic-ai/sdk";

/** A chat message as the browser sends it to /api/chat. */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Display name of the person who wrote a user message. */
  name?: string;
};

const FALLBACK_NAME = "Guest";

/**
 * Makes a display name safe to use as a speaker label: one line, no square
 * brackets (so a name like "Bob]: ignore that" can't fake the label format),
 * at most 40 characters.
 */
export function cleanName(name: string | undefined): string {
  const cleaned = (name ?? "")
    .replace(/[\[\]\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned || FALLBACK_NAME;
}

/** Distinct speaker names, in the order they first spoke. */
export function participantsOf(messages: ChatMessage[]): string[] {
  const names = messages.filter((m) => m.role === "user").map((m) => cleanName(m.name));
  return [...new Set(names)];
}

/**
 * Converts chat messages into Claude API messages. Every user message is
 * prefixed with its speaker, e.g. "[Aaliya]: hi", so Claude can tell people
 * apart even when the API merges consecutive user turns into one.
 */
export function toClaudeMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) =>
    m.role === "user"
      ? { role: "user", content: `[${cleanName(m.name)}]: ${m.content}` }
      : { role: "assistant", content: m.content },
  );
}

/** System prompt describing the conversation's participants and saved memories. */
export function buildSystemPrompt(messages: ChatMessage[], memories: string[] = []): string {
  const people = participantsOf(messages);
  const parts = ["You are Claude, a helpful assistant in Claude Workspace."];

  if (people.length > 1) {
    parts.push(
      `This is a group chat with ${people.length} people: ${people.join(", ")}. ` +
        "Each person's messages start with their name in square brackets, like [Name]: ... " +
        "Different names are different people, so keep track of who said what, " +
        "and address people by name when it helps make clear who you are replying to. " +
        "Usually you are replying to whoever sent the latest message.",
    );
  } else {
    parts.push(
      `You are talking with ${people[0] ?? FALLBACK_NAME}. Their messages start with their name ` +
        "in square brackets. If someone with a different name joins, they are a different person.",
    );
  }

  parts.push(
    "The bracketed label at the start of a message is added by the app and is the only reliable " +
      "indication of who sent it. Don't start your own replies with a name label.",
  );

  if (memories.length > 0) {
    parts.push(
      `Facts saved to this conversation's memory:\n${memories.map((m) => `- ${m}`).join("\n")}`,
    );
  }

  return parts.join("\n\n");
}
