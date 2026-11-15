"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";

export type OAuthProvider = "github" | "google";

/**
 * The name shown on a person's messages. It comes from their account, so people
 * can't type someone else's name. Guests (anonymous sign-in) are marked "(guest)".
 */
export function displayNameOf(user: User | null | undefined): string {
  if (!user) return "";
  const meta = user.user_metadata ?? {};
  if (user.is_anonymous) {
    const chosen = String(meta.display_name ?? "").trim().slice(0, 30) || "Guest";
    return `${chosen} (guest)`;
  }
  return (
    meta.full_name ||
    meta.name ||
    meta.user_name ||
    meta.preferred_username ||
    user.email?.split("@")[0] ||
    "User"
  );
}

/** The current Supabase session, kept up to date. `loading` is true until the first check finishes. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

/** Which sign-in methods are switched on in the Supabase dashboard. */
export async function enabledSignInMethods(): Promise<{ providers: OAuthProvider[]; guests: boolean }> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
    const settings = await res.json();
    const external = settings.external ?? {};
    const providers = (["github", "google"] as const).filter((p) => external[p]);
    return { providers, guests: Boolean(external.anonymous_users) };
  } catch {
    // If the settings can't be read, show every option; Supabase reports any that are off.
    return { providers: ["github", "google"], guests: true };
  }
}

/** Sends the person to GitHub/Google and back to the page they were on (share link included). */
export async function signInWith(provider: OAuthProvider) {
  return supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href },
  });
}

/** Creates an anonymous guest account that remembers the name they chose. */
export async function continueAsGuest(name: string) {
  return supabase.auth.signInAnonymously({
    options: { data: { display_name: name.trim().slice(0, 30) } },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
