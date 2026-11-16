import { supabase } from "./supabase";

export async function createConversation(title: string = "New Conversation") {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ title })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMessages(conversationId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function saveMessage(conversationId: string, role: string, content: string, senderName: string = "User") {
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, role, content, sender_name: senderName })
      .select()
      .single();
  
    if (error) throw error;
    return data;
  }

export async function pinMessage(messageId: string, isPinned: boolean) {
  const { error } = await supabase
    .from("messages")
    .update({ is_pinned: isPinned })
    .eq("id", messageId);

  if (error) throw error;
}

export async function getPinnedMessages(conversationId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("is_pinned", true)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function createBranch(parentConversationId: string, branchedFromMessageId: string) {
    const { data, error } = await supabase
      .from("branches")
      .insert({ 
        parent_conversation_id: parentConversationId, 
        branched_from_message_id: branchedFromMessageId 
      })
      .select()
      .single();
  
    if (error) throw error;
    return data;
  }
  
  export async function getBranches(conversationId: string) {
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .eq("parent_conversation_id", conversationId);
  
    if (error) throw error;
    return data;
  }

  /**
   * Returns an unguessable share token: 128 bits from the cryptographically
   * secure generator, encoded as 22 URL-safe characters.
   * (Math.random() is predictable and was producing ~11-character tokens.)
   */
  export function createSecureToken(byteLength = 16): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  export async function generateShareToken(conversationId: string) {
    const token = createSecureToken();

    const { error } = await supabase
      .from("conversations")
      .update({ share_token: token })
      .eq("id", conversationId)
      .select()
      .single();
  
    if (error) throw error;
    return token;
  }
  
  /**
   * Opens a share link: finds the conversation by its token and adds the
   * signed-in person as a member, so row-level security lets them in.
   * Returns null when the link is wrong or has been replaced.
   */
  export async function joinConversation(token: string) {
    const { data, error } = await supabase
      .rpc("join_conversation", { share: token })
      .maybeSingle<{ id: string; title: string }>();

    if (error) throw error;
    return data;
  }

  /** Every conversation the signed-in person owns or has joined, oldest first. */
  export async function listConversations() {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data as { id: string; title: string; created_at: string }[];
  }

  export async function saveMemory(conversationId: string, content: string) {
    const { data, error } = await supabase
      .from("memories")
      .insert({ conversation_id: conversationId, content })
      .select()
      .single();
  
    if (error) throw error;
    return data;
  }
  
  export async function getMemories(conversationId: string) {
    const { data, error } = await supabase
      .from("memories")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
  
    if (error) throw error;
    return data;
  }