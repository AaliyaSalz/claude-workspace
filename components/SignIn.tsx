"use client";

import { useEffect, useState } from "react";
import { continueAsGuest, enabledSignInMethods, signInWith, type OAuthProvider } from "@/lib/auth";

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Continue with Google",
};

/** Sign-in screen: Google (once enabled in Supabase) or a named guest. No account needed for guests. */
export default function SignIn() {
  const [methods, setMethods] = useState<{ providers: OAuthProvider[]; guests: boolean } | null>(null);
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    enabledSignInMethods().then(setMethods);
  }, []);

  async function handleProvider(provider: OAuthProvider) {
    setBusy(true);
    setError(null);
    const { error } = await signInWith(provider);
    // On success the browser leaves for Google, so we only get here on failure.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function handleGuest() {
    if (!guestName.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await continueAsGuest(guestName);
    if (error) setError(error.message);
    setBusy(false);
  }

  const hasProviders = (methods?.providers.length ?? 0) > 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white px-4">
      <div className="bg-gray-900 border border-gray-800 p-8 rounded-2xl flex flex-col gap-3 w-full max-w-80 shadow-2xl">
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-xl">✦</div>
          <h1 className="text-xl font-bold">Claude Workspace</h1>
          <p className="text-gray-400 text-xs text-center">A smarter way to work with AI</p>
        </div>

        {!methods && <p className="text-center text-xs text-gray-500">Loading sign-in options…</p>}

        {methods?.providers.map((provider) => (
          <button
            key={provider}
            onClick={() => handleProvider(provider)}
            disabled={busy}
            className="bg-white hover:bg-gray-200 disabled:opacity-50 text-gray-900 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            {PROVIDER_LABELS[provider]}
          </button>
        ))}

        {methods?.guests && (
          <>
            {hasProviders && (
              <div className="flex items-center gap-2 text-xs text-gray-500 my-1">
                <div className="flex-1 h-px bg-gray-800" /> or try it as a guest <div className="flex-1 h-px bg-gray-800" />
              </div>
            )}
            <input
              className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm outline-none focus:border-orange-500 transition-colors"
              placeholder="Your name"
              aria-label="Your name"
              maxLength={30}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGuest()}
            />
            <button
              onClick={handleGuest}
              disabled={busy || !guestName.trim()}
              className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              Continue as guest →
            </button>
            <p className="text-[11px] text-gray-500 text-center">Guests are labelled “(guest)” in shared chats.</p>
          </>
        )}

        {methods && !hasProviders && !methods.guests && (
          <p className="text-center text-xs text-red-400">No sign-in methods are enabled yet.</p>
        )}
        {error && <p role="alert" className="text-center text-xs text-red-400">{error}</p>}
        <a href="/privacy" className="text-center text-[11px] text-gray-500 hover:text-gray-300 underline mt-1">
          Privacy Policy
        </a>
      </div>
    </main>
  );
}
