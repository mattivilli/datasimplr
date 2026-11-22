/** Names and row counts for a file split into stem_1, stem_2, … */

export type SplitPlan = {
  stem: string;
  names: string[];
  rows: number[];
};

export function splitStem(fileName: string): string {
  const trimmed = fileName.trim() || "dataset";
  const stem = trimmed.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "").trim();
  return stem || "dataset";
}

export function splitPlan(fileName: string, rowCount: number, partRows: number): SplitPlan {
  const stem = splitStem(fileName);
  const size = Math.max(1, partRows);
  const count = Math.max(1, Math.ceil(Math.max(0, rowCount) / size));
  const names: string[] = [];
  const rows: number[] = [];
  for (let i = 0; i < count; i++) {
    names.push(`${stem}_${i + 1}`);
    const start = i * size;
    rows.push(Math.max(0, Math.min(size, rowCount - start)));
  }
  return { stem, names, rows };
}

export function splitNote(names: string[]): string {
  const count = names.length;
  const first = names[0] ?? "part_1";
  const last = names[count - 1] ?? first;
  const span = count <= 1 ? first : `${first} through ${last}`;
  return `Combined from ${count} part${count === 1 ? "" : "s"} (${span}). Counts, sums, averages, minimums, maximums, and grouped results include every part. The original file was not changed.`;
}
