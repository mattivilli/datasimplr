// Reads only the start of a text file to find the delimiter, the real header
// row, and junk before it (titles, blanks). The full file is never turned
// into JavaScript rows here.

export type Sniff = {
  delimiter: string;
  /** Records to skip before the header record. */
  skipRows: number;
  header: string[];
  notes: string[];
  repeatedHeaderInSample: boolean;
};

const SAMPLE_BYTES = 128 * 1024;

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isDelimitedName(name: string): boolean {
  const ext = extOf(name);
  return ext === "csv" || ext === "tsv" || ext === "txt" || ext === "text";
}

export function splitCsvRecords(text: string, delimiter: string, maxRecords: number): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const pushRow = () => {
    row.push(cur.trim());
    cur = "";
    if (row.some((cell) => cell.length > 0)) records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length && records.length < maxRecords; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cur.trim());
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else cur += ch;
  }
  return records;
}

function chooseDelimiter(text: string): string {
  const hint = text.includes("\t") ? "\t" : ",";
  let best = hint;
  let bestScore = -1;
  for (const delimiter of [",", "\t", ";", "|"]) {
    const records = splitCsvRecords(text, delimiter, 12);
    if (records.length < 2) continue;
    const width = records[0]?.length ?? 0;
    if (width < 2) continue;
    const consistent = records.filter((record) => record.length === width).length;
    const score = consistent * 10 + width;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function looksLikeHeader(cells: string[]): boolean {
  const filled = cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0);
  if (filled.length < 2) return false;
  const numeric = filled.filter((cell) => /^-?\d+(\.\d+)?$/.test(cell)).length;
  return numeric / filled.length < 0.5;
}

function sameWidth(a: string[] | undefined, b: string[] | undefined): boolean {
  return !!a && !!b && a.length > 1 && a.length === b.length;
}

export function sniffText(text: string): Sniff {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = chooseDelimiter(src);
  const records = splitCsvRecords(src, delimiter, 40);
  let headerAt = 0;
  for (let i = 0; i < records.length; i++) {
    const header = records[i];
    if (!looksLikeHeader(header ?? [])) continue;
    const next = records[i + 1];
    const after = records[i + 2];
    if (sameWidth(header, next) || sameWidth(header, after)) {
      headerAt = i;
      break;
    }
  }
  const header = (records[headerAt] ?? []).map((cell) => cell.replace(/^\uFEFF/, ""));
  const notes: string[] = [];
  if (headerAt > 0) {
    notes.push(
      headerAt === 1
        ? "Skipped 1 leading non-data row before the header. The original file is unchanged."
        : `Skipped ${headerAt} leading non-data rows before the header. The original file is unchanged.`,
    );
  }
  const signature = header.join("\u0000");
  const repeatedHeaderInSample = records.slice(headerAt + 1).some((record) => record.join("\u0000") === signature);
  if (repeatedHeaderInSample) {
    notes.push("Repeated header rows are excluded from analysis. The original file is unchanged.");
  }
  return { delimiter, skipRows: headerAt, header, notes, repeatedHeaderInSample };
}

export async function sniffTabularText(file: File): Promise<Sniff> {
  const sample = await file.slice(0, Math.min(file.size, SAMPLE_BYTES)).text();
  return sniffText(sample);
}

/** Estimate data rows from the first slice. Accurate for uniform CSV, instant. */
export async function estimateDataRows(file: File, sniff: Sniff): Promise<number> {
  const sliceLen = Math.min(file.size, 256 * 1024);
  const sample = await file.slice(0, sliceLen).text();
  const lastBreak = Math.max(sample.lastIndexOf("\n"), sample.lastIndexOf("\r"));
  const used = lastBreak > 0 ? sample.slice(0, lastBreak) : sample;
  const records = splitCsvRecords(used, sniff.delimiter, Number.POSITIVE_INFINITY);
  if (records.length < 2 || sliceLen === 0) return 0;
  const avg = new TextEncoder().encode(used).length / records.length;
  if (!Number.isFinite(avg) || avg <= 0) return 0;
  const totalRecords = Math.round(file.size / avg);
  return Math.max(0, totalRecords - sniff.skipRows - 1);
}
