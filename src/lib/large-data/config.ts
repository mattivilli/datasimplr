// Thresholds for Standard vs Large Dataset mode.
// standardMaxRows is the largest size at which the existing in-memory engine
// (parseDelimited + cleanTable + analyzeQuality) stayed responsive in
// scripts/bench-standard.ts. supportedMaxRows is the largest size the
// browser bench actually finished (scripts/bench-large-results.json).
// Do not raise supportedMaxRows without a passing bench entry.

export const LARGE_DATA = {
  /**
   * Largest tested size where parseDelimited + cleanTable + analyzeQuality
   * stayed under a second (8,000 rows, 552ms). 20,000 rows took 57s.
   */
  standardMaxRows: 8_000,
  /** Cell budget for wide files. 8,000 rows × 16 columns. */
  standardMaxCells: 128_000,
  /**
   * Used only when a row count is not known yet.
   * Sits between the passing 8,000-row file (667,784 bytes) and the
   * failing 20,000-row file (1,669,353 bytes).
   */
  standardMaxBytes: 768 * 1024,
  /** Largest size that finished in Chrome on this machine: 1,000,000 rows. */
  supportedMaxRows: 1_000_000,
  supportedMaxCells: 1_000_000 * 16,
  supportedMaxBytes: 120 * 1024 * 1024,
  /** A file this large is not scanned, even for a sample. */
  sampleMaxBytes: 250 * 1024 * 1024,
  /** Representative sample offered above the supported range. */
  sampleOfferRows: 100_000,
  /**
   * Files above this row count are not loaded as one table. They are split into
   * parts of this size, named stem_1, stem_2, …, and analyzed together.
   * 1 lakh rows. A full 100,000-row load finished; past that, one table is the slow path.
   */
  splitAtRows: 100_000,
  previewPageSize: 100,
  chartRows: 24,
  queryResultRows: 100,
  /** Random sample handed to Pyodide. Never the full large file. */
  pythonSampleRows: 20_000,
  /** Text columns with more distinct values than this are not treated as categories. */
  categoryCardinalityCap: 60,
  /** K-means / PCA run on this many rows and are labeled as a sample. */
  modelSampleRows: 20_000,
  /**
   * Files at or below this size skip the row estimate and stay on the standard
   * path. Kept under the measured knee so a small CSV cannot freeze the tab.
   */
  sniffSkipBytes: 64 * 1024,
} as const;

export type ProcessingMode = "standard" | "large" | "unsupported";

export function chooseProcessingMode(input: {
  rows?: number | null;
  bytes?: number | null;
  columns?: number | null;
}): ProcessingMode {
  const rows = input.rows ?? null;
  const bytes = input.bytes ?? null;
  const columns = input.columns ?? null;
  const cells = rows != null && columns != null ? rows * Math.max(columns, 1) : null;

  if (rows != null && rows > LARGE_DATA.supportedMaxRows) return "unsupported";
  if (cells != null && cells > LARGE_DATA.supportedMaxCells) return "unsupported";
  if (bytes != null && rows == null && bytes > LARGE_DATA.supportedMaxBytes) return "unsupported";

  if (rows != null && rows > LARGE_DATA.standardMaxRows) return "large";
  if (cells != null && cells > LARGE_DATA.standardMaxCells) return "large";
  if (rows == null && bytes != null && bytes > LARGE_DATA.standardMaxBytes) return "large";
  return "standard";
}

/**
 * Same decision as chooseProcessingMode, with a margin for sniffed row counts.
 * An estimate just under the standard cap still opens the large path; the exact
 * count then sends it back if it really is small. An estimate just over the
 * supported cap is still attempted, and the exact count rejects it if needed.
 */
export function chooseEstimatedMode(input: {
  rows?: number | null;
  bytes?: number | null;
  columns?: number | null;
}): ProcessingMode {
  const mode = chooseProcessingMode(input);
  const rows = input.rows ?? null;
  if (mode === "standard" && rows != null && rows > LARGE_DATA.standardMaxRows * 0.85) return "large";
  if (mode === "unsupported" && rows != null && rows <= Math.round(LARGE_DATA.supportedMaxRows * 1.15)) return "large";
  return mode;
}

export function workingCopyMessage(): string {
  const rows = LARGE_DATA.sampleOfferRows.toLocaleString();
  return `This file is too big to load in full in your browser. DataSimplr can prepare a ${rows}-row working file from it here. Results from that file are labeled as a sample. The original file is not changed.`;
}

export type BlockInfo = {
  kind: "wide" | "tall" | "other";
  title: string;
  /** Short line for the panel heading. */
  headline: string;
  body: string;
  /** Rows to offer as a labeled sample, or null when a sample would not shrink the file. */
  sampleRows: number | null;
  /** Most columns that fit at this row count, or null when columns are not the problem. */
  maxColumns: number | null;
  cells: number | null;
};

const millions = (cells: number) => `${(cells / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} million`;

/** Says which dimension of the file is over the limit, and which fixes would actually help. */
export function describeBlock(rows: number | null, columns: number | null): BlockInfo {
  const cap = LARGE_DATA.supportedMaxCells;
  const cells = rows != null && columns != null ? rows * columns : null;
  const rowText = rows != null ? rows.toLocaleString() : "";
  if (rows != null && rows > LARGE_DATA.supportedMaxRows) {
    const sample = LARGE_DATA.sampleOfferRows;
    return {
      kind: "tall",
      title: "Prepare a working file",
      headline: "This dataset is larger than the currently supported processing range.",
      body: `This file has about ${rowText} rows, more than the ${LARGE_DATA.supportedMaxRows.toLocaleString()} DataSimplr can load in full. It can prepare a ${sample.toLocaleString()}-row working file from it here. Results from that file are labeled as a sample. The original file is not changed.`,
      sampleRows: sample,
      maxColumns: null,
      cells,
    };
  }
  if (rows != null && columns != null && cells != null && cells > cap) {
    const maxColumns = Math.max(1, Math.floor(cap / rows));
    const rowsFit = Math.max(1000, Math.floor(cap / columns));
    return {
      kind: "wide",
      title: "This file is too wide to load in full",
      headline: `This file is too wide to load in full: ${rowText} rows × ${columns} columns.`,
      body: `This file has ${rowText} rows × ${columns} columns (${millions(cells)} cells). It is not too long, it is too wide: the limit is about ${millions(cap)} cells. Choose the columns you need (up to ${maxColumns} fit at this row count), or work from a ${rowsFit.toLocaleString()}-row sample that keeps every column. The original file is not changed.`,
      sampleRows: rowsFit < rows ? rowsFit : null,
      maxColumns,
      cells,
    };
  }
  const sample = LARGE_DATA.sampleOfferRows;
  const offerSample = rows == null || rows > sample;
  return {
    kind: "other",
    title: offerSample ? "Prepare a working file" : "This file could not be loaded in full",
    headline: "This dataset is larger than the currently supported processing range.",
    body: offerSample
      ? workingCopyMessage()
      : `This file could not be loaded in full in your browser${rows != null ? ` (${rowText} rows${columns != null ? ` × ${columns} columns` : ""})` : ""}. Filter it by a column value first, or choose fewer columns. The original file is not changed.`,
    sampleRows: offerSample ? sample : null,
    maxColumns: null,
    cells,
  };
}

export function rangeCopy(): { standard: string; large: string; above: string } {
  const standardMax = LARGE_DATA.standardMaxRows.toLocaleString();
  const largeMax = LARGE_DATA.supportedMaxRows.toLocaleString();
  return {
    standard: `Up to ${standardMax} rows`,
    large: `${(LARGE_DATA.standardMaxRows + 1).toLocaleString()} to ${largeMax} rows`,
    above: `Above ${largeMax} rows is not loaded in full`,
  };
}
