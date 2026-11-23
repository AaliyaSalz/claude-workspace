import type { ChatMessage } from "./chatPrompt";

/** Size limits for one /api/chat request. Input tokens cost money, so these are enforced on the server. */
export const CHAT_LIMITS = {
  messages: 100,
  userMessageChars: 20_000,
  assistantMessageChars: 60_000,
  memories: 50,
  memoryChars: 1_000,
  totalChars: 200_000,
};

const lengthOf = (items: { content: string }[]) => items.reduce((sum, item) => sum + item.content.length, 0);

/**
 * Trims a long chat to what the API accepts: all recent messages that fit, the
 * newest memories, and a first message from a person (as Claude expects).
 */
export function fitToLimits(messages: ChatMessage[], memories: string[]) {
  const fittedMemories = memories.slice(-CHAT_LIMITS.memories).map((m) => m.slice(0, CHAT_LIMITS.memoryChars));
  let room = CHAT_LIMITS.totalChars - fittedMemories.reduce((sum, m) => sum + m.length, 0);

  const recent: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && recent.length < CHAT_LIMITS.messages; i--) {
    room -= messages[i].content.length;
    if (room < 0 && recent.length > 0) break;
    recent.unshift(messages[i]);
  }
  while (recent.length > 1 && recent[0].role !== "user") recent.shift();

  return { messages: recent, memories: fittedMemories };
}

export type ChatRequest = { messages: ChatMessage[]; memories: string[] };

/** Checks an untrusted request body. Returns the request, or the reason it was refused. */
export function parseChatRequest(body: unknown): { request: ChatRequest } | { error: string; status: number } {
  const { messages, memories = [] } = (body ?? {}) as { messages?: unknown; memories?: unknown };

  if (!Array.isArray(messages) || messages.length === 0) return { error: "No messages were sent.", status: 400 };
  if (!Array.isArray(memories) || memories.some((m) => typeof m !== "string")) {
    return { error: "Memories are in the wrong format.", status: 400 };
  }

  const valid = messages.every(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0 &&
      (m.name === undefined || typeof m.name === "string"),
  );
  if (!valid || messages[messages.length - 1].role !== "user") {
    return { error: "Messages are in the wrong format.", status: 400 };
  }

  const chat = messages as ChatMessage[];
  const notes = memories as string[];
  const tooLong =
    chat.length > CHAT_LIMITS.messages ||
    notes.length > CHAT_LIMITS.memories ||
    notes.some((m) => m.length > CHAT_LIMITS.memoryChars) ||
    chat.some(
      (m) => m.content.length > (m.role === "user" ? CHAT_LIMITS.userMessageChars : CHAT_LIMITS.assistantMessageChars),
    ) ||
    lengthOf(chat) + notes.reduce((sum, m) => sum + m.length, 0) > CHAT_LIMITS.totalChars;
  if (tooLong) return { error: "That message is too long. Try a shorter one.", status: 413 };

  return { request: { messages: chat, memories: notes } };
}

const QUOTA_MESSAGES: Record<string, string> = {
  minute: "You're sending messages quickly. Wait a moment and try again.",
  guest_day: "You've reached today's guest limit. Sign in with Google for more, or come back tomorrow.",
  day: "You've reached today's message limit. Come back tomorrow.",
  app_day: "Claude Workspace has reached its daily limit. Please come back tomorrow.",
};

export function quotaMessage(reason: unknown): string {
  return QUOTA_MESSAGES[String(reason)] ?? "You've reached a usage limit. Try again later.";
}
