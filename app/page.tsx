"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import CodeBlock from "@/components/CodeBlock";
import SignIn from "@/components/SignIn";
import { displayNameOf, signOut, takePendingShareToken, useSession } from "@/lib/auth";
import { saveMessage, pinMessage, createBranch, generateShareToken, joinConversation, listConversations, saveMemory, getMemories } from "@/lib/db";
import { supabase } from "@/lib/supabase";

type Message = {
  id?: string;
  /** Client-only key for a message that hasn't been saved yet (e.g. a reply still streaming). */
  localId?: string;
  /** Client-only error notice: shown in the chat, never saved or sent to Claude. */
  isError?: boolean;
  role: "user" | "assistant";
  content: string;
  is_pinned?: boolean;
  is_snippet?: boolean;
  snippet_text?: string;
  sender_name?: string;
  source_message_id?: string;
};

type Conversation = {
  id: string;
  title: string;
  branchedFromMessageId?: string;
};

type SelectionPopup = {
  x: number;
  y: number;
  text: string;
  messageId: string;
} | null;

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationIndex, setActiveConversationIndex] = useState(0);
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Who is signed in. Names come from the account (or "Name (guest)"), so nobody
  // can post under someone else's name.
  const { user, loading: authLoading } = useSession();
  const userId = user?.id;
  const username = displayNameOf(user);
  const [memories, setMemories] = useState<string[]>([]);
  const [memoryInput, setMemoryInput] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Pins are read straight from the conversation's messages (snippets are message
  // rows too), so anything that updates `messages` - including Realtime events from
  // other participants - updates the pinned sidebar as well.
  const pinnedMessages = messages.filter((m) => m.is_pinned);

  useEffect(() => {
    // Start the workspace only once someone is signed in.
    if (!userId) return;

    const params = new URLSearchParams(window.location.search);
    // A share link opened before signing in with Google: its token was saved
    // before the redirect (see signInWith), in case the URL lost it on the way back.
    const pendingToken = takePendingShareToken();
    const token = params.get("token") ?? pendingToken;

    // After Google sign-in the URL carries a one-time ?code=; it has been
    // exchanged by now, so drop it, and put ?token= back so a reload stays in
    // the shared conversation.
    if (params.has("code") || (token && !params.has("token"))) {
      params.delete("code");
      if (token) params.set("token", token);
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }

    async function init() {
      try {
        // Opening a share link makes you a member of that conversation first,
        // so it shows up in your list below.
        let openId: string | null = null;
        if (token) {
          const shared = await joinConversation(token);
          if (shared) openId = shared.id;
          else setConnectionError("That share link doesn't work any more. Ask for a new one.");
        }

        // Row-level security only returns conversations you own or have joined.
        let list = await listConversations();
        if (list.length === 0) {
          const { data, error } = await supabase
            .from("conversations")
            .insert({ title: "Main Conversation" })
            .select("id, title, created_at")
            .single();
          if (error) throw error;
          list = [data];
        }

        const index = openId ? Math.max(0, list.findIndex((c) => c.id === openId)) : list.length - 1;
        const active = list[index];
        setConversations(list.map((c) => ({ id: c.id, title: c.title })));
        setActiveConversationIndex(index);
        setConversationId(active.id);

        const { data } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", active.id)
          .order("created_at", { ascending: true });
        setMessages(data || []);
        const mems = await getMemories(active.id);
        setMemories(mems.map((m: { content: string }) => m.content));
      } catch (e) {
        console.error("Error:", e);
        setConnectionError("Couldn't connect to the database. Check your connection and refresh the page.");
      }
    }
    init();
  }, [userId]);

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            // Our own message can arrive here before saveMessage() returns its id:
            // attach the id to the local copy instead of adding a duplicate.
            const localIndex = prev.findIndex(
              (m) => !m.id && m.role === newMessage.role && m.content === newMessage.content
            );
            if (localIndex !== -1) {
              return prev.map((m, i) => (i === localIndex ? { ...m, id: newMessage.id } : m));
            }
            return [...prev, newMessage];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          // Pinning or unpinning updates an existing row; apply it so every
          // participant's pinned sidebar stays in sync.
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    function handleClickOutside() {
      setSelectionPopup(null);
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function scrollToMessage(messageId: string) {
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(messageId);
      setTimeout(() => setHighlightedMessageId(null), 2000);
    }
  }

  async function handleNewConversation() {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: "New Conversation" })
      .select()
      .single();
    if (error || !data) return;
    const newConv = { id: data.id, title: "New Conversation" };
    setConversations(prev => [...prev, newConv]);
    setActiveConversationIndex(conversations.length);
    setConversationId(data.id);
    setMessages([]);
    setMemories([]);
    setShareUrl(null);
  }

  async function sendMessage() {
    if (!input.trim() || !conversationId || loading) return;

    const text = input;
    const userMessage: Message = { role: "user", content: text, sender_name: username, localId: crypto.randomUUID() };
    const history = [...messages, userMessage];
    const replyId = crypto.randomUUID();

    setMessages(history);
    setInput("");
    setLoading(true);
    setAwaitingFirstToken(true);

    const updateMessage = (localId: string, patch: Partial<Message>) =>
      setMessages((prev) => prev.map((m) => (m.localId === localId ? { ...m, ...patch } : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";

    try {
      const savedUser = await saveMessage(conversationId, "user", text, username);
      updateMessage(userMessage.localId!, { id: savedUser.id });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Include each speaker's name so Claude can tell group-chat participants apart.
          // Snippets are stored as message rows for pinning; they aren't part of the conversation.
          messages: history
            .filter((m) => !m.isError && !m.is_snippet)
            .map((m) => ({
              role: m.role,
              content: m.content,
              name: m.role === "user" ? m.sender_name || username : undefined,
            })),
          memories,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      // Show an empty bubble that fills in as text streams.
      setMessages((prev) => [...prev, { role: "assistant", content: "", localId: replyId }]);
      setAwaitingFirstToken(false);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        updateMessage(replyId, { content: reply });
      }
      reply += decoder.decode();
      if (!reply.trim()) throw new Error("Claude returned an empty response.");
    } catch (e) {
      const stopped = controller.signal.aborted;
      if (!stopped) console.error("Chat error:", e);
      if (!reply.trim()) {
        // Nothing usable arrived: replace the empty bubble with an error notice (not saved).
        setMessages((prev) => [
          ...prev.filter((m) => m.localId !== replyId),
          {
            role: "assistant",
            localId: replyId,
            isError: true,
            content: stopped
              ? "⏹ Stopped before Claude replied."
              : `⚠️ Claude couldn't respond: ${e instanceof Error ? e.message : String(e)}`,
          },
        ]);
        return;
      }
      // Partial reply (stopped or cut off): keep what arrived and save it below.
      if (!stopped) reply += "\n\n⚠️ The response was cut off.";
      updateMessage(replyId, { content: reply });
    } finally {
      abortRef.current = null;
      setAwaitingFirstToken(false);
      setLoading(false);
    }

    try {
      const savedReply = await saveMessage(conversationId, "assistant", reply, "Claude");
      updateMessage(replyId, { id: savedReply.id });
    } catch (e) {
      console.error("Failed to save reply:", e);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  async function handlePin(message: Message) {
    if (!message.id || !conversationId) return;
    const newPinned = !message.is_pinned;
    // Update the screen right away, then save; roll back if the save fails.
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, is_pinned: newPinned } : m));
    try {
      await pinMessage(message.id, newPinned);
    } catch (e) {
      console.error("Failed to update pin:", e);
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, is_pinned: !newPinned } : m));
    }
  }

  function handleTextSelection(messageId: string) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (!text || text.length < 5) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setSelectionPopup({
      x: rect.left + rect.width / 2,
      y: rect.top - 10 + window.scrollY,
      text,
      messageId,
    });
  }

  async function pinSelection() {
    if (!selectionPopup || !conversationId) return;

    const { data: snippet, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: selectionPopup.text,
        is_pinned: true,
        is_snippet: true,
        snippet_text: selectionPopup.text,
        source_message_id: selectionPopup.messageId,
      })
      .select()
      .single();

    if (error) { console.error(error); return; }

    setSelectionPopup(null);
    // Realtime delivers the same row to everyone (us included); skip it if it's already here.
    setMessages(prev => (prev.some(m => m.id === snippet.id) ? prev : [...prev, snippet]));
  }

  async function handleBranch(message: Message) {
    if (!message.id || !conversationId) return;

    const { data: newConv, error } = await supabase
      .from("conversations")
      .insert({ title: `Branch ${conversations.length}` })
      .select()
      .single();

    if (error || !newConv) return;

    await createBranch(conversationId, message.id);

    // Copy the conversation up to and including this message (snippets stay with the
    // original). Use the saved copies so the branch has its own ids and no inherited pins;
    // otherwise pinning in the branch would pin the original conversation's message.
    const conversation = messages.filter((m) => !m.is_snippet && !m.isError);
    const cutoff = conversation.findIndex((m) => m.id === message.id);
    const messagesToCopy: Message[] = [];
    for (const msg of conversation.slice(0, cutoff + 1)) {
      messagesToCopy.push(await saveMessage(newConv.id, msg.role, msg.content, msg.sender_name));
    }

    const newConversation: Conversation = {
      id: newConv.id,
      title: `Branch ${conversations.length}`,
      branchedFromMessageId: message.id,
    };

    setConversations(prev => [...prev, newConversation]);
    setActiveConversationIndex(conversations.length);
    setConversationId(newConv.id);
    setMessages(messagesToCopy);
  }

  async function switchConversation(index: number) {
    const conv = conversations[index];
    setActiveConversationIndex(index);
    setConversationId(conv.id);

    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });

    setMessages(data || []);
    const mems = await getMemories(conv.id);
    setMemories(mems.map((m: { content: string }) => m.content));
    setShareUrl(null);
  }

  async function handleShare() {
    if (!conversationId) return;
    try {
      const token = await generateShareToken(conversationId);
      setShareUrl(`${window.location.origin}?token=${encodeURIComponent(token)}`);
    } catch (e) {
      console.error("Failed to create share link:", e);
      setConnectionError("Couldn't create a share link. Please try again.");
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSaveMemory() {
    if (!memoryInput.trim() || !conversationId) return;
    await saveMemory(conversationId, memoryInput);
    setMemories(prev => [...prev, memoryInput]);
    setMemoryInput("");
  }

  if (authLoading) {
    // This is also what the pre-rendered HTML contains, so crawlers see real text.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-gray-950 text-white px-4 text-center">
        <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-xl">✦</div>
        <h1 className="text-xl font-bold">Claude Workspace</h1>
        <p className="text-gray-400 text-sm max-w-md">
          A smarter way to work with AI: branching conversations, memory, pinned snippets and shared chats with Claude.
        </p>
        <p className="text-gray-600 text-xs mt-2">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return <SignIn />;
  }

  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">

      {/* Selection Popup */}
      {selectionPopup && (
        <div
          className="fixed z-50 bg-yellow-400 text-black text-xs px-3 py-1 rounded-full shadow-lg cursor-pointer hover:bg-yellow-300 font-medium transition-colors"
          style={{ left: selectionPopup.x, top: selectionPopup.y, transform: "translate(-50%, -100%)" }}
          onMouseDown={(e) => { e.preventDefault(); pinSelection(); }}
        >
          ✂️ Pin Selection
        </div>
      )}

      {/* Left Sidebar */}
      <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-900 h-screen">

        {/* Logo */}
        <div className="p-4 border-b border-gray-800 flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center text-sm">✦</div>
          <span className="font-semibold text-sm">Claude Workspace</span>
        </div>

        {/* Scrollable sidebar content */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

          {/* Share Button */}
          <div>
            <button
              onClick={handleShare}
              className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2"
            >
              🔗 Share Conversation
            </button>
            {shareUrl && (
              <div className="mt-2 flex flex-col gap-1">
                <p className="text-xs text-gray-500 break-all">{shareUrl}</p>
                <button
                  onClick={copyShareUrl}
                  className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded-lg transition-colors"
                >
                  {copied ? "✅ Copied!" : "Copy Link"}
                </button>
              </div>
            )}
          </div>

          {/* Conversations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Conversations</p>
              <button
                onClick={handleNewConversation}
                className="text-xs text-gray-500 hover:text-orange-400 transition-colors font-medium"
              >
                + New
              </button>
            </div>
            {conversations.map((conv, index) => (
              <button
                key={conv.id}
                onClick={() => switchConversation(index)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs mb-1 transition-colors ${
                  activeConversationIndex === index
                    ? "bg-orange-500 text-white"
                    : "text-gray-300 hover:bg-gray-800"
                }`}
              >
                {index === 0 ? "💬" : "🌿"} {conv.title}
              </button>
            ))}
          </div>

          {/* Pinned Messages */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Pinned</p>
            {pinnedMessages.length === 0 && (
              <p className="text-xs text-gray-600">Pin messages to save them here.</p>
            )}
            {pinnedMessages.map((msg) => (
              <div
                key={msg.id}
                onClick={() => {
                  if (msg.is_snippet && msg.source_message_id) {
                    scrollToMessage(msg.source_message_id);
                  } else if (msg.id) {
                    scrollToMessage(msg.id);
                  }
                }}
                className="bg-gray-800 hover:bg-gray-700 rounded-lg p-2 text-xs text-gray-300 line-clamp-2 mb-1 cursor-pointer transition-colors border border-transparent hover:border-gray-600"
              >
                {msg.is_snippet ? "✂️ " : "📌 "}{msg.is_snippet ? msg.snippet_text : msg.content}
              </div>
            ))}
          </div>

          {/* Memory */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Memory</p>
            {memories.length === 0 && (
              <p className="text-xs text-gray-600 mb-2">Save facts for Claude to remember.</p>
            )}
            {memories.map((mem, index) => (
              <div key={index} className="bg-gray-800 rounded-lg p-2 text-xs text-gray-300 mb-1">
                🧠 {mem}
              </div>
            ))}
            <input
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:border-orange-500 transition-colors mt-1"
              placeholder="Add a memory..."
              value={memoryInput}
              onChange={(e) => setMemoryInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveMemory()}
            />
          </div>

        </div>

        {/* User Badge */}
        <div className="p-4 border-t border-gray-800 flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
            {username.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-gray-300 truncate flex-1" title={username}>{username}</span>
          <button
            onClick={async () => {
              await signOut();
              // Reload so no conversation state carries over to the next person.
              window.location.reload();
            }}
            className="text-xs text-gray-500 hover:text-white transition-colors shrink-0"
          >
            Sign out
          </button>
        </div>

      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">

        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900 shrink-0">
          <span className="text-sm font-medium">
            {conversations[activeConversationIndex]?.title || "Conversation"}
          </span>
          <span className="text-xs text-gray-500">powered by Claude</span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center text-2xl">✦</div>
              <p className="text-gray-400 text-sm">Send a message to start chatting with Claude.</p>
            </div>
          )}
          {messages.filter(msg => !msg.is_snippet).map((msg, index) => (
            <div
              key={index}
              id={`message-${msg.id}`}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} group transition-all duration-500 ${
                highlightedMessageId === msg.id ? "scale-[1.01]" : ""
              }`}
            >
              <div className="flex items-start gap-2 max-w-2xl w-full">
                {msg.role === "assistant" && (
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-6 shrink-0">
                    <button
                      onClick={() => handlePin(msg)}
                      className={`text-xs px-2 py-1 rounded-lg transition-colors ${msg.is_pinned ? "bg-yellow-500 text-black" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                    >
                      {msg.is_pinned ? "📌" : "Pin"}
                    </button>
                    <button
                      onClick={() => handleBranch(msg)}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 hover:bg-green-800 hover:text-green-300 transition-colors"
                    >
                      Branch
                    </button>
                  </div>
                )}
                <div className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end ml-auto" : "items-start"}`}>
                  <span className="text-xs text-gray-500 px-2">
                    {msg.sender_name || (msg.role === "user" ? username : "Claude")}
                  </span>
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm leading-relaxed break-words transition-all duration-500 ${
                      msg.role === "user"
                        ? "bg-orange-500 text-white rounded-tr-sm"
                        : "bg-gray-800 text-gray-100 rounded-tl-sm"
                    } ${highlightedMessageId === msg.id ? "ring-2 ring-yellow-400" : ""}`}
                    onMouseUp={() => {
                      setTimeout(() => {
                        if (msg.id) handleTextSelection(msg.id);
                      }, 10);
                    }}
                  >
                    {msg.role === "assistant" ? (
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                          li: ({ children }) => <li className="text-sm">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                          h1: ({ children }) => <h1 className="text-base font-bold mb-2">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                          // Fenced blocks keep rehype-highlight's classes; inline `code` gets a pill style.
                          code: ({ className, children }) =>
                            className ? (
                              <code className={className}>{children}</code>
                            ) : (
                              <code className="bg-gray-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                            ),
                          pre: CodeBlock,
                        }}
                        // Highlight only blocks that name their language; guessing mislabels plain text.
                        rehypePlugins={[rehypeHighlight]}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
                {msg.role === "user" && (
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-6 shrink-0">
                    <button
                      onClick={() => handlePin(msg)}
                      className={`text-xs px-2 py-1 rounded-lg transition-colors ${msg.is_pinned ? "bg-yellow-500 text-black" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                    >
                      {msg.is_pinned ? "📌" : "Pin"}
                    </button>
                    <button
                      onClick={() => handleBranch(msg)}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 hover:bg-green-800 hover:text-green-300 transition-colors"
                    >
                      Branch
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {awaitingFirstToken && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 bg-gray-800 text-gray-400 px-4 py-3 rounded-2xl rounded-tl-sm text-sm">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-800 bg-gray-900 shrink-0">
          {connectionError && (
            <p role="alert" className="mb-2 text-sm text-red-400">{connectionError}</p>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              className="flex-1 resize-none max-h-48 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500 transition-colors"
              placeholder="Message Claude... (Shift+Enter for a new line)"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Grow with the content, up to max-h-48.
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendMessage();
                  if (inputRef.current) inputRef.current.style.height = "auto";
                }
              }}
            />
            {loading ? (
              <button
                onClick={stopGenerating}
                aria-label="Stop generating"
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors shrink-0"
              >
                ■ Stop
              </button>
            ) : (
              <button
                onClick={() => {
                  sendMessage();
                  if (inputRef.current) inputRef.current.style.height = "auto";
                }}
                disabled={!input.trim() || !conversationId}
                className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors shrink-0"
              >
                Send
              </button>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}