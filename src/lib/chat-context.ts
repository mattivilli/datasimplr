import {
  cleanTable,
  correlationMatrix,
  describeNumeric,
  detectTypes,
  executiveInsights,
  type Table,
} from "./analysis";
import { parseUploadedFile } from "./parse-file";

const TABULAR = new Set(["xlsx", "xls", "csv", "tsv", "json"]);
const TEXT = new Set(["txt", "md", "csv", "tsv", "json"]);

export type ChatAttachment = {
  name: string;
  kind: "dataset" | "document";
  sizeLabel: string;
  context: string;
  localSummary: string;
};

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function sampleTable(table: Table, limit = 5) {
  const cols = table.columns.slice(0, 8);
  const header = cols.join(" | ");
  const rows = table.rows.slice(0, limit).map((r) => cols.map((_, i) => (r[i] ?? "").slice(0, 40)).join(" | "));
  return [header, ...rows].join("\n");
}

function datasetContext(table: Table, name: string): ChatAttachment {
  const cleaned = cleanTable(table, { fill: "mean", removeDuplicates: true }).table;
  const types = detectTypes(cleaned);
  const numeric = cleaned.columns.filter((c) => types[c] === "numeric");
  const other = cleaned.columns.filter((c) => types[c] !== "numeric");
  const stats = describeNumeric(cleaned)
    .slice(0, 10)
    .map(
      (c) =>
        `${c.name}: n=${c.n}, mean=${c.mean.toFixed(2)}, median=${c.median.toFixed(2)}, std=${c.std.toFixed(2)}, min=${c.min.toFixed(2)}, max=${c.max.toFixed(2)}, skew=${c.skew.toFixed(2)}`,
    )
    .join("\n");
  const corr = correlationMatrix(cleaned);
  const pairs: string[] = [];
  for (let i = 0; i < corr.names.length; i++) {
    for (let j = i + 1; j < corr.names.length; j++) {
      pairs.push(`${corr.names[i]} ↔ ${corr.names[j]}: r=${corr.matrix[i]![j]!.toFixed(2)}`);
    }
  }
  pairs.sort((a, b) => Math.abs(Number(b.split("r=")[1])) - Math.abs(Number(a.split("r=")[1])));
  const insights = executiveInsights(cleaned).join("\n- ");

  const context = [
    `Dataset file: ${name}`,
    `Rows: ${cleaned.rows.length.toLocaleString()}  Columns: ${cleaned.columns.length}`,
    `Numeric: ${numeric.join(", ") || "none"}`,
    `Other: ${other.join(", ") || "none"}`,
    "",
    "Descriptive statistics:",
    stats || "No numeric columns.",
    "",
    "Strongest correlations:",
    pairs.slice(0, 8).join("\n") || "Need at least two numeric columns.",
    "",
    "Executive insights:",
    `- ${insights}`,
    "",
    "Sample rows:",
    sampleTable(cleaned),
  ].join("\n");

  const localSummary = [
    `Loaded **${name}**: ${cleaned.rows.length.toLocaleString()} rows × ${cleaned.columns.length} columns (${numeric.length} numeric).`,
    insights.split("\n")[0] ?? "",
    numeric.length
      ? `Key numeric fields: ${numeric.slice(0, 6).join(", ")}.`
      : "No numeric fields detected — I can still summarise categories and text.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    name,
    kind: "dataset",
    sizeLabel: `${cleaned.rows.length.toLocaleString()} rows`,
    context: context.slice(0, 14000),
    localSummary,
  };
}

export async function prepareChatFile(file: File): Promise<ChatAttachment> {
  const ext = extOf(file.name);
  const sizeLabel = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

  if (["pdf", "docx", "doc"].includes(ext)) {
    const text = await file.text().catch(() => "");
    const printable = text.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u024f]/g, " ").replace(/\s+/g, " ").trim();
    if (printable.length < 80) {
      throw new Error("I can't read that PDF/Word binary here. Export it as CSV, Excel, TXT or JSON and attach that.");
    }
    return {
      name: file.name,
      kind: "document",
      sizeLabel,
      context: `Document file: ${file.name}\n\n${printable.slice(0, 12000)}`,
      localSummary: `Loaded document **${file.name}** (${sizeLabel}). Ask me to summarise, extract metrics, or turn it into actions.`,
    };
  }

  if (TABULAR.has(ext) || TEXT.has(ext)) {
    try {
      const parsed = await parseUploadedFile(file);
      if (parsed.table.columns.length >= 2 && parsed.table.rows.length >= 2) {
        return datasetContext(parsed.table, parsed.sourceName);
      }
    } catch {
      // fall through to raw text
    }
  }

  const raw = await file.text();
  if (!raw.trim()) throw new Error("That file looks empty.");
  return {
    name: file.name,
    kind: "document",
    sizeLabel,
    context: `Document file: ${file.name}\n\n${raw.slice(0, 12000)}`,
    localSummary: `Loaded **${file.name}** (${sizeLabel}). I can summarise it and pull out the findings that matter.`,
  };
}

export const ANALYZE_PROMPT =
  "Analyse this uploaded file. Write a Snapshot, Key findings, Evidence table, Data quality, and a single Next action in DataSimplr. Use only numbers from the file context.";
