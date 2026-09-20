import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askAssistant, DEFAULT_GROQ_MODEL, GROQ_MODELS } from "@/lib/ai.functions";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";

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
  "Which model should I use for 18 months of monthly sales?",
  "How do I evaluate a RAG pipeline without labelled data?",
  "My SQL dashboard times out on 40M rows — where do I start?",
  "Explain data leakage with a concrete example.",
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
  const bottom = useRef<HTMLDivElement>(null);

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
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;

      let conversationId = c;
      if (!conversationId) {
        const { data, error } = await supabase
          .from("conversations")
          .insert({ user_id: userId, title: text.slice(0, 60), kind: "expert" })
          .select("id")
          .single();
        if (error) throw error;
        conversationId = data.id;
        await navigate({ search: { c: conversationId } });
      }

      await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, user_id: userId, role: "user", content: text });

      const history = [
        ...(messages ?? []).map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      const { reply } = await ask({ data: { messages: history.slice(-20), model } });

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
    if (!trimmed || send.isPending) return;
    setInput("");
    setPending(trimmed);
    send.mutate(trimmed);
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
      subtitle="Groq models — same setup as the original localhost DataSimplr chat."
      actions={
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-border bg-muted px-2 py-1.5 text-xs"
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
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
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

        <div className="panel flex min-h-[70vh] flex-col overflow-hidden">
          <div className="flex-1 space-y-4 p-5">
            {!c && !pending && (
              <div className="mx-auto max-w-lg py-10 text-center">
                <h2 className="font-display text-xl font-semibold">Ask anything about data</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Statistics, machine learning, RAG, evaluation, pipelines or SQL.
                </p>
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
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                      : "max-w-[90%] whitespace-pre-wrap rounded-2xl border border-border bg-muted px-4 py-3 text-sm leading-relaxed text-foreground"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}

            {pending && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="flex items-center gap-2 border-t border-border bg-muted px-4 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data, models or SQL…"
              className="flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-subtle"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={send.isPending}
              className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </WorkspaceShell>
  );
}
