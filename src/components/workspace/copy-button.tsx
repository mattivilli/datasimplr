import { useState } from "react";
import { Check, Copy } from "lucide-react";

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className = "",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value.trim()) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground ${className}`}
    >
      {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

export function extractCodeBlocks(markdown: string) {
  const blocks: { lang: string; code: string }[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const code = m[2]!.replace(/\n$/, "");
    if (code.trim()) blocks.push({ lang: m[1]!.trim() || "code", code });
  }
  return blocks;
}
