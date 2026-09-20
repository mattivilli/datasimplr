import * as XLSX from "xlsx";
import { parseDelimited, type Table } from "./analysis";

const MAX_BYTES = 50 * 1024 * 1024;

function tableFromObjects(rows: Record<string, unknown>[]): Table {
  if (!rows.length) return { columns: [], rows: [] };
  const columns = Object.keys(rows[0]!);
  return {
    columns,
    rows: rows.map((row) => columns.map((c) => stringify(row[c]))),
  };
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sheetToTable(sheet: XLSX.WorkSheet): Table {
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return tableFromObjects(json);
}

export async function parseUploadedFile(file: File): Promise<{ table: Table; sourceName: string }> {
  if (file.size > MAX_BYTES) {
    throw new Error("That file is larger than 50 MB. Try a smaller extract.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const sourceName = file.name;

  if (["xlsx", "xls"].includes(ext)) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const first = workbook.SheetNames[0];
    if (!first) throw new Error("That spreadsheet has no worksheets.");
    return { table: sheetToTable(workbook.Sheets[first]!), sourceName };
  }

  const text = await file.text();

  if (ext === "json") {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      const rows = parsed.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : { value: item },
      );
      return { table: tableFromObjects(rows), sourceName };
    }
    if (parsed && typeof parsed === "object") {
      return { table: tableFromObjects([parsed as Record<string, unknown>]), sourceName };
    }
    throw new Error("JSON must be an object or an array of objects.");
  }

  return { table: parseDelimited(text), sourceName };
}
