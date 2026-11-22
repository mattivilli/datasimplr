import { chooseEstimatedMode, chooseProcessingMode, LARGE_DATA, type ProcessingMode } from "./config";
import { estimateDataRows, isDelimitedName, sniffTabularText, type Sniff } from "./sniff";

const SPREADSHEET_CAP = 50 * 1024 * 1024;

export type FileDecision = {
  mode: ProcessingMode;
  bytes: number;
  rows: number | null;
  columns: number | null;
  sniff: Sniff | null;
  reason?: "rows" | "bytes" | "spreadsheet";
};

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export async function classifyFile(file: File): Promise<FileDecision> {
  const bytes = file.size;
  const ext = extOf(file.name);
  if (ext === "xlsx" || ext === "xls" || ext === "json") {
    if (bytes > SPREADSHEET_CAP) {
      return { mode: "unsupported", bytes, rows: null, columns: null, sniff: null, reason: "spreadsheet" };
    }
    return { mode: "standard", bytes, rows: null, columns: null, sniff: null };
  }
  if (!isDelimitedName(file.name)) {
    return { mode: "standard", bytes, rows: null, columns: null, sniff: null };
  }
  if (bytes > LARGE_DATA.sampleMaxBytes) {
    return { mode: "unsupported", bytes, rows: null, columns: null, sniff: null, reason: "bytes" };
  }
  if (bytes <= LARGE_DATA.sniffSkipBytes) {
    return { mode: "standard", bytes, rows: null, columns: null, sniff: null };
  }
  const sniff = await sniffTabularText(file);
  const columns = sniff.header.length || null;
  const rows = await estimateDataRows(file, sniff);
  const mode = chooseEstimatedMode({ rows, bytes, columns });
  return {
    mode,
    bytes,
    rows,
    columns,
    sniff,
    ...(mode === "unsupported" ? { reason: rows != null && rows > LARGE_DATA.supportedMaxRows ? "rows" as const : "bytes" as const } : {}),
  };
}

export function storedDatasetMode(input: {
  file_type?: string | null;
  file_size?: number | null;
  row_count?: number | null;
  column_count?: number | null;
}): ProcessingMode {
  const ext = (input.file_type ?? "").toLowerCase();
  if (ext === "xlsx" || ext === "xls" || ext === "json") return "standard";
  return chooseProcessingMode({
    rows: input.row_count ?? null,
    bytes: input.file_size ?? null,
    columns: input.column_count ?? null,
  });
}

/** An over-cap CSV can still open when it will be split into parts instead of one table. */
export function opensAsSplit(decision: FileDecision): boolean {
  if (decision.reason === "spreadsheet") return false;
  if (decision.bytes > LARGE_DATA.sampleMaxBytes) return false;
  if (decision.mode === "large") return (decision.rows ?? 0) > LARGE_DATA.splitAtRows;
  if (decision.mode !== "unsupported") return false;
  return decision.rows == null || decision.rows > LARGE_DATA.splitAtRows;
}

export function unsupportedMessage(rows: number | null): string {
  const size = rows != null ? ` (about ${rows.toLocaleString()} rows)` : "";
  return `This dataset${size} is larger than the currently supported processing range (up to ${LARGE_DATA.supportedMaxRows.toLocaleString()} rows).`;
}

export class UseStandardPath extends Error {
  override readonly name = "UseStandardPath";
  constructor() {
    super("This file fits the standard engine.");
  }
}

export class DatasetTooLargeError extends Error {
  override readonly name = "DatasetTooLargeError";
  readonly rows: number | null;
  readonly bytes: number;
  constructor(message: string, rows: number | null, bytes: number) {
    super(message);
    this.rows = rows;
    this.bytes = bytes;
  }
}
