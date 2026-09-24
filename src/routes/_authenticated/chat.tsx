import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Loader2, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askAssistant, DEFAULT_GROQ_MODEL, GROQ_MODELS, planDatasetQuery } from "@/lib/ai.functions";
import {
  buildDatasetMeta,
  explainPrompt,
  plannerSchema,
  pythonInputs,
  PY_MAX_ROWS,
  stashLabHandoff,
  takeExplain,
  type DatasetSelection,
  type ExplainPayload,
} from "@/lib/dataset-context";
import { formatResultsForPrompt, runQueryOp, type QueryResult } from "@/lib/dataset-query";
import { DatasetContextBar } from "@/components/workspace/dataset-context-bar";
import { useDatasetContext } from "@/components/workspace/use-dataset-context";
import {
  ANALYZE_PROMPT,
  chatFileSheetNames,
  datasetContext,
  detectPastedTable,
  prepareChatFile,
  type ChatAttachment,
} from "@/lib/chat-context";
import { parseDelimited } from "@/lib/analysis";
import { loadActiveDataset, saveActiveDataset, type StoredDataset } from "@/lib/dataset-store";
import { WorkspaceShell } from "@/components/workspace/shell";
import { MarkdownMessage } from "@/components/workspace/markdown-message";
import { CopyButton, extractCodeBlocks } from "@/components/workspace/copy-button";
import { Button } from "@/components/ui/button";
import { openPythonLab, WithPythonSplit } from "@/components/workspace/with-python-split";
import { ScrollTop } from "@/components/workspace/scroll-top";

export const Route = createFileRoute("/_authenticated/chat")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search["c"] === "string" ? search["c"] : undefined,
    dataset: typeof search["dataset"] === "string" ? search["dataset"] : undefined,
    version: typeof search["version"] === "string" ? search["version"] : undefined,
    sheet: typeof search["sheet"] === "string" ? search["sheet"] : undefined,
    explain: search["explain"] === "1" || search["explain"] === 1 ? "1" : undefined,
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

const datasetStarters = [
  "Summarize this dataset for management.",
  "Which data-quality issues remain?",
  "What changed between the original and finalized dataset?",
  "Find potential anomalies.",
];

// Stored user messages start with a "[Dataset] name | version" badge line; the
// analysis request handed to PythonLab should be just what the user asked.
const stripDatasetHeader = (text: string) => text.replace(/^\[Dataset\][^\n]*\n\n/, "");

const NO_DATASET = { dataset: undefined, version: undefined, sheet: undefined, explain: undefined } as const;

type Message = { id: string; role: string; content: string; created_at: string };

function ChatPage() {
  const { c, dataset, version, sheet, explain } = Route.useSearch();
  const navigate = useNavigate({ from: "/chat" });
  const queryClient = useQueryClient();
  const ask = useServerFn(askAssistant);
  const plan = useServerFn(planDatasetQuery);
  const selection: DatasetSelection | null = dataset ? { datasetId: dataset, versionId: version, sheetName: sheet } : null;
  const dsState = useDatasetContext(selection);
  const dsRef = useRef(dsState);
  dsRef.current = dsState;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const skipPlanRef = useRef(false);
  const clearedFor = useRef<string | null>(null);
  const explainHandled = useRef(false);
  const [labRequest, setLabRequest] = useState<string | undefined>();
  const py = useMemo(() => (dsState.ctx ? pythonInputs(dsState.ctx) : null), [dsState.ctx]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [model, setModel] = useState<string>(DEFAULT_GROQ_MODEL);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheetOptions, setSheetOptions] = useState<string[] | null>(null);
  const [resumable, setResumable] = useState<StoredDataset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef<ChatAttachment | null>(null);
  const [chatsOpen, setChatsOpen] = useState(true);
  attachmentRef.current = attachment;

  useEffect(() => {
    void loadActiveDataset().then(setResumable);
  }, []);

  const { data: convDataset } = useQuery({
    queryKey: ["conv-dataset", c],
    enabled: !!c && !dataset,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("dataset_id, dataset_version_id, sheet_name")
        .eq("id", c!)
        .maybeSingle();
      return error ? null : data;
    },
  });

  useEffect(() => {
    if (c && !dataset && convDataset?.dataset_id && clearedFor.current !== c) {
      void navigate({
        search: {
          c,
          dataset: convDataset.dataset_id,
          version: convDataset.dataset_version_id ?? undefined,
          sheet: convDataset.sheet_name ?? undefined,
          explain: undefined,
        },
        replace: true,
      });
    }
  }, [c, dataset, convDataset, navigate]);

  const effectiveVersionId = dsState.ctx?.requestedVersion.id;
  const effectiveSheet = dsState.ctx?.sheetName ?? null;
  const effectiveDatasetId = dsState.ctx?.dataset.id;
  useEffect(() => {
    if (!c || !effectiveDatasetId) return;
    void supabase
      .from("conversations")
      .update({ dataset_id: effectiveDatasetId, dataset_version_id: effectiveVersionId ?? null, sheet_name: effectiveSheet })
      .eq("id", c)
      .then(
        () => undefined,
        () => undefined,
      );
  }, [c, effectiveDatasetId, effectiveVersionId, effectiveSheet]);

  const selectDataset = (next: DatasetSelection | null) => {
    if (next) {
      clearedFor.current = null;
      setAttachment(null);
      attachmentRef.current = null;
      setResumable(null);
    } else {
      clearedFor.current = c ?? null;
      if (c) {
        void supabase
          .from("conversations")
          .update({ dataset_id: null, dataset_version_id: null, sheet_name: null })
          .eq("id", c)
          .then(
            () => undefined,
            () => undefined,
          );
      }
    }
    void navigate({
      search: {
        c,
        dataset: next?.datasetId,
        version: next?.versionId,
        sheet: next?.sheetName,
        explain: undefined,
      },
      replace: true,
    });
  };

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
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || pending) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    setChatsOpen(localStorage.getItem("ds_chats_collapsed") !== "1");
  }, []);

  const toggleChats = () => {
    setChatsOpen((v) => {
      const next = !v;
      localStorage.setItem("ds_chats_collapsed", next ? "0" : "1");
      return next;
    });
  };

  const send = useMutation({
    mutationFn: async (text: string) => {
      const file = attachmentRef.current;
      const ds = file ? null : dsRef.current.ctx;
      const visible = ds
        ? `[Dataset] ${ds.displayName} | ${ds.versionLabel}` + String.fromCharCode(10, 10) + text
        : file ? `📎 ${file.name}\n\n${text}` : text;
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;

      let conversationId = c;
      if (!conversationId) {
        const title = ds
          ? `${ds.displayName}: ${text}`.slice(0, 60)
          : file ? `${file.name}: ${text}`.slice(0, 60) : text.slice(0, 60);
        const { data, error } = await supabase
          .from("conversations")
          .insert({
            user_id: userId,
            title,
            kind: "expert",
            ...(ds ? { dataset_id: ds.dataset.id, dataset_version_id: ds.requestedVersion.id, sheet_name: ds.sheetName } : {}),
          })
          .select("id")
          .single();
        if (error) throw error;
        conversationId = data.id;
        await navigate({
          search: {
            c: conversationId,
            dataset: ds?.dataset.id,
            version: ds?.requestedVersion.id,
            sheet: ds?.sheetName ?? undefined,
            explain: undefined,
          },
        });
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

      let context = file?.context;
      if (ds) {
        // Plan -> compute on the real data -> explain. Only the schema goes to
        // the planner; only the (small) computed results go to the explainer.
        let results: QueryResult[] = [];
        const skipPlan = skipPlanRef.current;
        skipPlanRef.current = false;
        if (!skipPlan) {
          try {
            const recent = (messages ?? []).filter((m) => m.role === "user").slice(-3).map((m) => m.content.slice(0, 300));
            const planned = await plan({ data: { question: text, recent, schema: plannerSchema(ds), model } });
            results = planned.ops.map((op) => runQueryOp(ds.table, op));
          } catch (e) {
            console.error("Dataset planning failed", e);
          }
        }
        const nl = String.fromCharCode(10);
        context = [
          buildDatasetMeta(ds, dsRef.current.log),
          "",
          results.length
            ? "## Computed results (run on the real dataset just now; authoritative - quote numbers exactly, never adjust them)" +
              nl +
              formatResultsForPrompt(results)
            : "## Computed results" +
              nl +
              "(No operation was run for this question. Do not state new figures; say what is missing, or suggest running it in PythonLab.)",
          "",
          "Answer the user's question directly and concisely, using the computed results and dataset facts above. Use the Snapshot / Key findings layout only when they ask for a full summary. State which version and sheet the numbers come from.",
        ]
          .join(nl)
          .slice(0, 15800);
      }

      const { reply } = await ask({
        data: { messages: history.slice(-20), model, ...(context ? { context } : {}) },
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
    onError: (err) => {
      console.error("Chat send failed", err);
      setChatError(err instanceof Error ? err.message : "Something went wrong sending that. Please try again.");
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
    if (selectionRef.current && !dsRef.current.ctx) {
      setChatError(dsRef.current.error ?? "The dataset is still loading - try again in a moment.");
      return;
    }
    if (!attachmentRef.current && !dsRef.current.ctx && trimmed) {
      const table = detectPastedTable(trimmed);
      if (table) {
        const built = datasetContext(table, "Pasted data");
        setAttachment(built);
        attachmentRef.current = built;
        setResumable(null);
        if (built.csv) void saveActiveDataset({ csv: built.csv, fileName: built.name, columns: built.columns ?? [] });
      }
    }
    const prompt = trimmed || ANALYZE_PROMPT;
    setInput("");
    setFileError(null);
    setChatError(null);
    setPending(
      dsRef.current.ctx && !attachmentRef.current
        ? `[Dataset] ${dsRef.current.ctx.displayName} | ${dsRef.current.ctx.versionLabel}` + String.fromCharCode(10, 10) + prompt
        : attachmentRef.current ? `📎 ${attachmentRef.current.name}\n\n${prompt}` : prompt);
    send.mutate(prompt);
  };

  const loadChatFile = async (file: File, sheetName?: string) => {
    setReadingFile(true);
    try {
      const prepared = await prepareChatFile(file, sheetName);
      if (selectionRef.current) selectDataset(null);
      setAttachment(prepared);
      attachmentRef.current = prepared;
      setResumable(null);
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

  const onPickFile = async (file: File | null) => {
    if (!file || send.isPending) return;
    setFileError(null);
    setReadingFile(true);
    try {
      const sheets = await chatFileSheetNames(file);
      if (sheets && sheets.length > 1) {
        setPendingFile(file);
        setSheetOptions(sheets);
        setReadingFile(false);
        return;
      }
      await loadChatFile(file, sheets?.[0]);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Could not read that file.");
      setReadingFile(false);
    }
  };

  const chooseSheet = async (name: string) => {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    setSheetOptions(null);
    await loadChatFile(file, name);
  };

  const cancelSheetPick = () => {
    setPendingFile(null);
    setSheetOptions(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitExplain = (result: ExplainPayload) => {
    const ctx = dsRef.current.ctx;
    if (!ctx) return;
    skipPlanRef.current = true;
    submit(explainPrompt(ctx, result));
  };

  useEffect(() => {
    if (!explain || !dsState.ctx || explainHandled.current) return;
    const payload = takeExplain();
    explainHandled.current = true;
    void navigate({ search: { c, dataset, version, sheet, explain: undefined }, replace: true });
    if (payload) submitExplain(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explain, dsState.ctx]);

  const openFullLab = (code: string, question: string) => {
    const sel = selectionRef.current;
    if (!sel) return;
    stashLabHandoff({ request: question, code });
    void navigate({ to: "/lab", search: { dataset: sel.datasetId, version: sel.versionId, sheet: sel.sheetName } });
  };

  const runInLab = (code: string, question: string) => {
    setLabRequest(question);
    openPythonLab(code);
  };

  const resumeDataset = async () => {
    if (!resumable) return;
    setReadingFile(true);
    try {
      const table = parseDelimited(resumable.csv);
      const built = datasetContext(table, resumable.fileName);
      setAttachment(built);
      attachmentRef.current = built;
      setResumable(null);
    } finally {
      setReadingFile(false);
    }
  };

  const removeChat = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    if (c === id) await navigate({ search: { c: undefined, dataset, version, sheet, explain: undefined } });
  };

  return (
    <WorkspaceShell
      title="AI Chat"
      subtitle="GPT-OSS 20B by default — cheapest Groq model that still reasons well over your files."
      actions={
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
      }
    >
      <WithPythonSplit
        csv={py?.csv ?? attachment?.csv}
        fileName={py?.fileName ?? attachment?.name}
        columns={py?.columns ?? attachment?.columns}
        request={labRequest}
        onExplain={dsState.ctx ? submitExplain : undefined}
      >
      <div className={`grid min-h-[calc(100dvh-8.5rem)] min-w-0 gap-3 ${chatsOpen ? "lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]" : "lg:grid-cols-[auto_minmax(0,1fr)]"}`}>
        <div className={`relative min-w-0 ${chatsOpen ? "" : "lg:w-10"}`}>
          <button
            type="button"
            aria-label={chatsOpen ? "Hide chats" : "Show chats"}
            onClick={toggleChats}
            className="absolute -right-2 top-4 z-20 hidden size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground lg:flex"
          >
            {chatsOpen ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {chatsOpen ? (
        <div className="panel flex h-full max-h-[calc(100dvh-8.5rem)] flex-col p-3">
          <Button className="w-full shrink-0" size="sm" onClick={() => navigate({ search: { c: undefined, dataset, version, sheet, explain: undefined } })}>
            <Plus className="mr-1.5 size-4" /> New chat
          </Button>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Saved chats</p>
          <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
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
                  onClick={() => navigate({ search: { c: conv.id, ...NO_DATASET } })}
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
          ) : (
            <div className="hidden h-full items-start pt-12 lg:flex">
              <span className="sr-only">Chats collapsed</span>
            </div>
          )}
        </div>

        <div className="panel relative flex min-h-[70vh] min-w-0 flex-col overflow-hidden lg:min-h-0 lg:h-[calc(100dvh-8.5rem)]">
          <DatasetContextBar
            edge="top"
            ctx={dsState.ctx}
            loading={dsState.loading}
            error={dsState.error}
            selection={selection}
            onSelect={selectDataset}
            truncatedRows={py?.truncated ? PY_MAX_ROWS : undefined}
          />

          <div ref={threadRef} className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            <ScrollTop target={threadRef} local />
            {!c && !pending && (
              <div className="mx-auto max-w-lg py-10 text-center">
                <h2 className="font-display text-2xl font-semibold tracking-tight">Start a briefing</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Drop a spreadsheet or ask a question. Answers stay in this thread; Python lab is one click away.
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
                  {(dsState.ctx ? datasetStarters : starters).map((s) => (
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

            {messages?.map((m, idx) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                ) : (
                  <AssistantReply
                    content={m.content}
                    question={stripDatasetHeader(messages[idx - 1]?.content ?? "")}
                    onRun={runInLab}
                    onOpenLab={dsState.ctx ? openFullLab : undefined}
                  />
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

          {chatError && (
            <div className="border-t border-border bg-accent/40 px-4 py-2 text-xs text-destructive">
              {chatError}
            </div>
          )}

          {sheetOptions && pendingFile && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-accent/40 px-4 py-2 text-xs">
              <span className="text-muted-foreground">
                {pendingFile.name} has {sheetOptions.length} sheets · pick one:
              </span>
              {sheetOptions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void chooseSheet(name)}
                  className="rounded-lg border border-border bg-muted px-2.5 py-1 font-medium hover:border-primary hover:text-foreground"
                >
                  {name}
                </button>
              ))}
              <button type="button" onClick={cancelSheetPick} className="text-subtle hover:text-destructive">
                Cancel
              </button>
            </div>
          )}

          {!attachment && !sheetOptions && resumable && !selection && (
            <div className="flex items-center gap-2 border-t border-border bg-accent/40 px-4 py-2 text-xs">
              <Paperclip className="size-3.5 text-primary" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                Continue with <span className="font-medium text-foreground">{resumable.fileName}</span> from Upload &amp; Analyze
              </span>
              <button
                type="button"
                onClick={() => void resumeDataset()}
                className="shrink-0 rounded-lg border border-border bg-muted px-2.5 py-1 font-semibold hover:border-primary hover:text-foreground"
              >
                Use it
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setResumable(null)}
                className="text-subtle hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

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
            className="flex items-end gap-2 border-t border-border bg-muted/80 px-3 py-3 sm:px-4"
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
            <textarea
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder={dsState.ctx ? `Ask about ${dsState.ctx.displayName}...` : attachment ? `Ask about ${attachment.name}…` : "Ask about your data, or drop a file…"}
              className="max-h-28 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-subtle"
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

function AssistantReply({
  content,
  question,
  onRun,
  onOpenLab,
}: {
  content: string;
  question: string;
  onRun: (code: string, question: string) => void;
  onOpenLab?: ((code: string, question: string) => void) | undefined;
}) {
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
              onClick={() => onRun(code, question)}
              className="inline-flex items-center rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
            >
              Run in PythonLab
            </button>
            {onOpenLab ? (
              <button
                type="button"
                onClick={() => onOpenLab(code, question)}
                className="inline-flex items-center rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
              >
                Open in full PythonLab
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
