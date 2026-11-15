"use client";

import { useRef, useState, type ComponentProps, type ReactElement } from "react";

/**
 * Renders a fenced code block from react-markdown: a header with the
 * language name and a Copy button, then the (already highlighted) code.
 */
export default function CodeBlock({ children }: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // react-markdown passes the <code> element as the only child; its className
  // carries the language, e.g. "hljs language-ts".
  const codeClass = (children as ReactElement<{ className?: string }>)?.props?.className ?? "";
  const language = /language-([\w+#-]+)/.exec(codeClass)?.[1];

  async function copy() {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }

  return (
    <div className="mb-2 rounded-lg overflow-hidden border border-gray-700 bg-gray-950 last:mb-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-700 text-xs text-gray-400">
        <span className="font-mono">{language ?? "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="hover:text-white transition-colors"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={preRef}
        className="p-3 text-xs font-mono overflow-x-auto whitespace-pre [&>code]:bg-transparent [&>code]:p-0"
      >
        {children}
      </pre>
    </div>
  );
}
