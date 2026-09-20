import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askAssistant, DEFAULT_GROQ_MODEL, GROQ_MODELS } from "@/lib/ai.functions";
import { ANALYZE_PROMPT, prepareChatFile, type ChatAttachment } from "@/lib/chat-context";
import { saveActiveDataset } from "@/lib/dataset-store";
import { WorkspaceShell } from "@/components/workspace/shell";
import { MarkdownMessage } from "@/components/workspace/markdown-message";
import { CopyButton, extractCodeBlocks } from "@/components/workspace/copy-button";
import { Button } from "@/components/ui/button";
import { openPythonLab, WithPythonSplit } from "@/components/workspace/with-python-split";

export const Route = createFileRoute("/_authenticated/chat")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === "string" ? search.c : undefined,
  }),
  head: () => ({
    meta: [
      { title: "AI Chat — DataSimplr Workspace" },
      { name: "description", content: "Your saved AI conversations about data, ML and SQL." },
      { property: "og:title", content: "AI Chat — DataSimplr Workspace" },
      { property: "og:description", content: "Your saved AI conversations about data, ML and SQL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChatPage,
});

const starters = [
  "Summarise this file and list the top findings.",
  "What data-quality issues should I fix first?",
  "Which columns should I use for regression, and why?",
  "Recommend clustering or PCA on this dataset.",
];

type Message = { id: string; role: string; content: string; created_at: string };

function ChatPage() {
  const { c } = Route.useSearch();
  const navigate = useNavigate({ from: "/chat" });
  const queryClient = useQueryClient();
  const ask = useServerFn(askAssistant);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [model, setModel] = useState<string>(DEFAULT_GROQ_MODEL);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef<ChatAttachment | null>(null);
  attachmentRef.current = attachment;

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", c],
    enabled: !!c,
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", c!)
        .order("created_at");
      return (data ?? []) as Message[];
    },
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const file = attachmentRef.current;
      const visible = file ? `📎 ${file.name}\n\n${text}` : text;
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;

      let conversationId = c;
      if (!conversationId) {
        const title = file ? `${file.name}: ${text}`.slice(0, 60) : text.slice(0, 60);
        const { data, error } = await supabase
          .from("conversations")
          .insert({ user_id: userId, title, kind: "expert" })
          .select("id")
          .single();
        if (error) throw error;
        conversationId = data.id;
        await navigate({ search: { c: conversationId } });
      }

      await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, user_id: userId, role: "user", content: visible });

      const history = [
        ...(messages ?? []).map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      const { reply } = await ask({
        data: { messages: history.slice(-20), model, context: file?.context },
      });

      await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, user_id: userId, role: "assistant", content: reply });
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      return conversationId;
    },
    onSettled: (conversationId) => {
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId ?? c] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const submit = (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && !attachmentRef.current) || send.isPending) return;
    const prompt = trimmed || ANALYZE_PROMPT;
    setInput("");
    setFileError(null);
    setPending(attachmentRef.current ? `📎 ${attachmentRef.current.name}\n\n${prompt}` : prompt);
    send.mutate(prompt);
  };

  const onPickFile = async (file: File | null) => {
    if (!file || send.isPending) return;
    setFileError(null);
    setReadingFile(true);
    try {
      const prepared = await prepareChatFile(file);
      setAttachment(prepared);
      attachmentRef.current = prepared;
      if (prepared.csv) {
        await saveActiveDataset({
          csv: prepared.csv,
          fileName: prepared.name,
          columns: prepared.columns ?? [],
        });
      }
      submit(ANALYZE_PROMPT);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setReadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeChat = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    if (c === id) await navigate({ search: {} });
  };

  return (
    <WorkspaceShell
      title="AI Chat"
      subtitle="GPT-OSS 20B by default — cheapest Groq model that still reasons well over your files."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="max-w-[11rem] rounded-lg border border-border bg-muted px-2 py-1.5 text-xs sm:max-w-none"
            aria-label="Groq model"
          >
            {GROQ_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.badge} · {m.label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => navigate({ search: {} })}>
            <Plus className="mr-1.5 size-4" /> New chat
          </Button>
        </div>
      }
    >
      <WithPythonSplit csv={attachment?.csv} fileName={attachment?.name} columns={attachment?.columns}>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <div className="panel h-fit p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Saved chats</p>
          <div className="mt-3 space-y-1.5">
            {(conversations?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No saved chats yet.</p>
            )}
            {conversations?.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                  c === conv.id ? "border-primary bg-accent" : "border-border bg-muted hover:border-primary"
                }`}
              >
                <button
                  onClick={() => navigate({ search: { c: conv.id } })}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {conv.title}
                </button>
                <button
                  aria-label="Delete chat"
                  onClick={() => removeChat(conv.id)}
                  className="text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel flex min-h-[60vh] min-w-0 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 p-5">
            {!c && !pending && (
              <div className="mx-auto max-w-lg py-10 text-center">
                <h2 className="font-display text-xl font-semibold">Upload a file and ask</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Drop Excel, CSV, JSON or a text report. I will profile it and answer from that data.
                </p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onPickFile(e.dataTransfer.files[0] ?? null);
                  }}
                  className="mt-6 w-full rounded-2xl border border-dashed border-border bg-muted px-5 py-8 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  <Paperclip className="mx-auto mb-2 size-5 text-primary" />
                  Drop a file here or click to browse
                  <span className="mt-1 block text-[11px] text-subtle">.xlsx .xls .csv .json .txt .md</span>
                </button>
                <div className="mt-6 grid gap-2">
                  {starters.map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="rounded-xl border border-border bg-muted px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages?.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                ) : (
                  <AssistantReply content={m.content} />
                )}
              </div>
            ))}

            {pending && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {pending}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" /> Thinking…
                </div>
              </>
            )}
            <div ref={bottom} />
          </div>

          {(attachment || fileError || readingFile) && (
            <div className="flex items-center gap-2 border-t border-border bg-accent/40 px-4 py-2 text-xs">
              {readingFile ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Reading file…
                </span>
              ) : attachment ? (
                <>
                  <Paperclip className="size-3.5 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {attachment.name}
                    <span className="ml-2 text-subtle">{attachment.sizeLabel}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Remove file"
                    onClick={() => {
                      setAttachment(null);
                      attachmentRef.current = null;
                    }}
                    className="text-subtle hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : null}
              {fileError && <span className="text-destructive">{fileError}</span>}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onPickFile(e.dataTransfer.files[0] ?? null);
            }}
            className="flex items-center gap-2 border-t border-border bg-muted px-4 py-3"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.json,.txt,.md,.pdf,.docx"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              aria-label="Attach file"
              onClick={() => fileRef.current?.click()}
              disabled={send.isPending || readingFile}
              className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={attachment ? `Ask about ${attachment.name}…` : "Attach a file or ask about data…"}
              className="flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-subtle"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={send.isPending || readingFile}
              className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
      </WithPythonSplit>
    </WorkspaceShell>
  );
}

function AssistantReply({ content }: { content: string }) {
  const code = extractCodeBlocks(content)
    .map((b) => b.code)
    .join("\n\n");

  return (
    <div className="max-w-[92%] rounded-2xl border border-border bg-card px-5 py-4 shadow-[0_18px_40px_-28px_var(--glow)]">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">DataSimplr AI</p>
      <MarkdownMessage content={content} />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
        <CopyButton value={content} label="Copy reply" copiedLabel="Copied reply" />
        {code ? (
          <>
            <CopyButton value={code} label="Copy all code" copiedLabel="Copied code" />
            <button
              type="button"
              onClick={() => openPythonLab(code)}
              className="inline-flex items-center rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
            >
              Run in lab
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
