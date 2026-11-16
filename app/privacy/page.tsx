import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy · ${SITE_NAME}`,
  description: `How ${SITE_NAME} handles your data.`,
  alternates: { canonical: "/privacy" },
};

const UPDATED = "November 16, 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-300 px-4 py-12">
      <article className="mx-auto max-w-2xl flex flex-col gap-6 text-sm leading-relaxed">
        <header className="flex flex-col gap-2">
          <Link href="/" className="text-orange-400 hover:text-orange-300 text-xs">
            ← Back to {SITE_NAME}
          </Link>
          <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
          <p className="text-xs text-gray-500">Last updated {UPDATED}</p>
        </header>

        <p>
          {SITE_NAME} is a student portfolio project: a chat workspace built on the Claude API. This page explains
          what it stores, why, and who else sees it.
        </p>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">What we collect</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>
              <strong className="text-white">Account details.</strong> If you sign in with Google, we receive your
              name, email address and profile picture from Google. If you continue as a guest, we only store the name
              you type.
            </li>
            <li>
              <strong className="text-white">What you create.</strong> Conversations, messages, pinned messages,
              branches and saved memories.
            </li>
          </ul>
          <p>We don&apos;t use advertising or third-party analytics, and we don&apos;t sell your data.</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">How it&apos;s used</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>To show your name on your messages and keep you signed in.</li>
            <li>To save your conversations so you can come back to them.</li>
            <li>To let people you share a conversation link with read and reply to it.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Services that process your data</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>
              <strong className="text-white">Anthropic (Claude API)</strong> receives the messages in a conversation
              and your saved memories so Claude can reply. When Claude searches the web or opens a link, that request
              goes through Anthropic too.
            </li>
            <li>
              <strong className="text-white">Supabase</strong> stores the account details and content listed above.
            </li>
            <li>
              <strong className="text-white">Vercel</strong> hosts the site and may keep standard server logs.
            </li>
            <li>
              <strong className="text-white">Google</strong> handles Google sign-in.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Shared conversations</h2>
          <p>
            Anyone with a conversation&apos;s share link can read and add to it, and sees the names of the people in
            it. Share links are long random codes and are hidden from search engines, but treat them like a password:
            only send them to people you trust.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Your choices</h2>
          <p>
            You can sign out at any time. To have your account and content deleted, open an issue on the project&apos;s{" "}
            <a
              href="https://github.com/AaliyaSalz/claude-workspace/issues"
              className="text-orange-400 hover:text-orange-300 underline"
            >
              GitHub page
            </a>{" "}
            and it will be removed. Please don&apos;t put sensitive personal, medical or financial information in
            chats.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Changes</h2>
          <p>If this policy changes, the date at the top of this page will change too.</p>
        </section>
      </article>
    </main>
  );
}
