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

function isSpreadsheet(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "xlsx" || ext === "xls";
}

// Peek at an Excel file's sheet names without fully parsing it, so the caller
// can offer a picker when there's more than one. Returns null for non-Excel
// files (nothing to pick from).
export async function getSheetNames(file: File): Promise<string[] | null> {
  if (!isSpreadsheet(file)) return null;
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", bookSheets: true });
  return workbook.SheetNames;
}

export async function parseUploadedFile(
  file: File,
  sheetName?: string,
): Promise<{ table: Table; sourceName: string; sheetName?: string }> {
  if (file.size > MAX_BYTES) {
    throw new Error("That file is larger than 50 MB. Try a smaller extract.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const sourceName = file.name;

  if (isSpreadsheet(file)) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const chosen = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
    if (!chosen) throw new Error("That spreadsheet has no worksheets.");
    return { table: sheetToTable(workbook.Sheets[chosen]!), sourceName, sheetName: chosen };
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
