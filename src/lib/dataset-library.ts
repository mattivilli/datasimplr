import { supabase } from "@/integrations/supabase/client";
import { parseUploadedFile } from "./parse-file";
import { tableToCsv, type Table } from "./analysis";
import type { Tables } from "@/integrations/supabase/types";

export const DATASET_BUCKET = "datasets";

export type DatasetRow = Tables<"datasets">;
export type DatasetVersionRow = Tables<"dataset_versions">;
export type CleaningLogRow = Tables<"dataset_cleaning_log">;

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "csv";
}

// Persists a File as a brand-new dataset (version 1, kind "original") in
// Supabase Storage + the datasets/dataset_versions tables. The dataset row
// is the permanent identity; IndexedDB (dataset-store.ts) stays a same-device
// working cache only, never the source of truth.
export async function saveDataset(params: {
  userId: string;
  file: File;
  name: string;
  rowCount: number;
  columnCount: number;
  sheetName?: string | null;
}): Promise<{ datasetId: string; versionId: string }> {
  const datasetId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const storageKey = `${params.userId}/${datasetId}/${versionId}/${params.file.name}`;

  const { error: uploadErr } = await supabase.storage.from(DATASET_BUCKET).upload(storageKey, params.file, {
    ...(params.file.type ? { contentType: params.file.type } : {}),
    upsert: false,
  });
  if (uploadErr) throw uploadErr;

  const { error: dsErr } = await supabase.from("datasets").insert({
    id: datasetId,
    user_id: params.userId,
    name: params.name,
    original_filename: params.file.name,
    file_type: extOf(params.file.name),
    file_size: params.file.size,
    row_count: params.rowCount,
    column_count: params.columnCount,
    status: "uploaded",
  });
  if (dsErr) throw dsErr;

  const { error: verErr } = await supabase.from("dataset_versions").insert({
    id: versionId,
    dataset_id: datasetId,
    user_id: params.userId,
    version_number: 1,
    kind: "original",
    storage_key: storageKey,
    row_count: params.rowCount,
    column_count: params.columnCount,
    sheet_name: params.sheetName ?? null,
  });
  if (verErr) throw verErr;

  const { error: updErr } = await supabase
    .from("datasets")
    .update({ current_version_id: versionId })
    .eq("id", datasetId);
  if (updErr) throw updErr;

  return { datasetId, versionId };
}

export async function listDatasets(): Promise<DatasetRow[]> {
  const { data, error } = await supabase
    .from("datasets")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listDatasetsWithCurrentVersion(): Promise<
  (DatasetRow & { currentVersion: DatasetVersionRow | null })[]
> {
  const datasets = await listDatasets();
  const versionIds = datasets.map((d) => d.current_version_id).filter((id): id is string => !!id);
  if (!versionIds.length) return datasets.map((d) => ({ ...d, currentVersion: null }));
  const { data: versionRows, error } = await supabase.from("dataset_versions").select("*").in("id", versionIds);
  if (error) throw error;
  const byId = new Map((versionRows ?? []).map((v) => [v.id, v]));
  return datasets.map((d) => ({ ...d, currentVersion: d.current_version_id ? (byId.get(d.current_version_id) ?? null) : null }));
}

export async function getDataset(id: string): Promise<DatasetRow | null> {
  const { data, error } = await supabase.from("datasets").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getVersion(id: string): Promise<DatasetVersionRow | null> {
  const { data, error } = await supabase.from("dataset_versions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// Downloads the stored file for a version. RLS on storage.objects is what
// actually enforces ownership here — this call fails for anyone but the
// owner regardless of what the caller claims.
export async function downloadVersionBlob(version: DatasetVersionRow): Promise<Blob> {
  const { data, error } = await supabase.storage.from(DATASET_BUCKET).download(version.storage_key);
  if (error) throw error;
  return data;
}

// Working/finalized versions are always stored as CSV snapshots, so they must
// be parsed as CSV — parsing them under the original .xls/.xlsx name would
// push them through the spreadsheet reader and reformat date-like strings.
export function versionFilename(dataset: DatasetRow, version: DatasetVersionRow): string {
  const original = dataset.original_filename ?? `${dataset.name}.csv`;
  return version.kind === "original" ? original : `${original.replace(/\.[^.]+$/, "")}.csv`;
}

export async function loadDatasetTable(
  dataset: DatasetRow,
  version: DatasetVersionRow,
): Promise<{ table: Table; sourceName: string; file: File }> {
  const blob = await downloadVersionBlob(version);
  const filename = versionFilename(dataset, version);
  const file = new File([blob], filename, { type: blob.type });
  const parsed = await parseUploadedFile(file, version.sheet_name ?? undefined);
  return { table: parsed.table, sourceName: dataset.name, file };
}

// Triggers a browser save of the original file, named as it was uploaded.
export async function downloadDatasetFile(dataset: DatasetRow, version: DatasetVersionRow): Promise<void> {
  const blob = await downloadVersionBlob(version);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = dataset.original_filename ?? `${dataset.name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function listVersions(datasetId: string): Promise<DatasetVersionRow[]> {
  const { data, error } = await supabase
    .from("dataset_versions")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("version_number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function csvFile(table: Table, baseName: string): File {
  const stem = baseName.replace(/\.[^.]+$/, "");
  return new File([tableToCsv(table)], `${stem}.csv`, { type: "text/csv" });
}

// The working copy is a single mutable snapshot (not one file per edit) —
// each cleaning action overwrites it in place, while the cleaning log keeps
// the granular audit trail. v1 (original) is never touched.
export async function saveWorkingVersion(params: {
  dataset: DatasetRow;
  table: Table;
  userId: string;
  qualityScore: number;
  existingWorkingVersion: DatasetVersionRow | null;
}): Promise<DatasetVersionRow> {
  const { dataset, table, userId, qualityScore, existingWorkingVersion } = params;
  const file = csvFile(table, dataset.original_filename ?? dataset.name);

  if (existingWorkingVersion) {
    const { error: upErr } = await supabase.storage
      .from(DATASET_BUCKET)
      .upload(existingWorkingVersion.storage_key, file, { contentType: "text/csv", upsert: true });
    if (upErr) throw upErr;
    const { data, error } = await supabase
      .from("dataset_versions")
      .update({ row_count: table.rows.length, column_count: table.columns.length, quality_score: qualityScore })
      .eq("id", existingWorkingVersion.id)
      .select("*")
      .single();
    if (error) throw error;
    await supabase.from("datasets").update({ status: "cleaning" }).eq("id", dataset.id);
    return data;
  }

  const versions = await listVersions(dataset.id);
  const nextVersionNumber = Math.max(1, ...versions.map((v) => v.version_number)) + 1;
  const versionId = crypto.randomUUID();
  const storageKey = `${userId}/${dataset.id}/${versionId}/${file.name}`;
  const { error: uploadErr } = await supabase.storage
    .from(DATASET_BUCKET)
    .upload(storageKey, file, { contentType: "text/csv", upsert: false });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from("dataset_versions")
    .insert({
      id: versionId,
      dataset_id: dataset.id,
      user_id: userId,
      version_number: nextVersionNumber,
      kind: "working",
      sheet_name: versions.find((v) => v.kind === "original")?.sheet_name ?? null,
      storage_key: storageKey,
      row_count: table.rows.length,
      column_count: table.columns.length,
      quality_score: qualityScore,
    })
    .select("*")
    .single();
  if (error) throw error;

  await supabase
    .from("datasets")
    .update({ current_version_id: versionId, status: "cleaning" })
    .eq("id", dataset.id);

  return data;
}

export async function finalizeDataset(params: {
  dataset: DatasetRow;
  table: Table;
  userId: string;
  qualityScore: number;
}): Promise<DatasetVersionRow> {
  const { dataset, table, userId, qualityScore } = params;
  const file = csvFile(table, dataset.original_filename ?? dataset.name);
  const versions = await listVersions(dataset.id);
  const nextVersionNumber = Math.max(1, ...versions.map((v) => v.version_number)) + 1;
  const versionId = crypto.randomUUID();
  const storageKey = `${userId}/${dataset.id}/${versionId}/${file.name}`;

  const { error: uploadErr } = await supabase.storage
    .from(DATASET_BUCKET)
    .upload(storageKey, file, { contentType: "text/csv", upsert: false });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from("dataset_versions")
    .insert({
      id: versionId,
      dataset_id: dataset.id,
      user_id: userId,
      version_number: nextVersionNumber,
      kind: "finalized",
      sheet_name: versions.find((v) => v.kind === "original")?.sheet_name ?? null,
      storage_key: storageKey,
      row_count: table.rows.length,
      column_count: table.columns.length,
      quality_score: qualityScore,
    })
    .select("*")
    .single();
  if (error) throw error;

  await supabase
    .from("datasets")
    .update({ current_version_id: versionId, status: "finalized" })
    .eq("id", dataset.id);

  return data;
}

export async function logCleaningChanges(
  entries: {
    datasetId: string;
    datasetVersionId: string;
    userId: string;
    rowReference: string | null;
    columnName: string | null;
    originalValue: string | null;
    newValue: string | null;
    operation: string;
    reason: string;
  }[],
): Promise<void> {
  if (!entries.length) return;
  const { error } = await supabase.from("dataset_cleaning_log").insert(
    entries.map((e) => ({
      dataset_id: e.datasetId,
      dataset_version_id: e.datasetVersionId,
      user_id: e.userId,
      row_reference: e.rowReference,
      column_name: e.columnName,
      original_value: e.originalValue,
      new_value: e.newValue,
      operation: e.operation,
      reason: e.reason,
    })),
  );
  if (error) throw error;
}

export async function getCleaningLog(datasetVersionId: string): Promise<CleaningLogRow[]> {
  const { data, error } = await supabase
    .from("dataset_cleaning_log")
    .select("*")
    .eq("dataset_version_id", datasetVersionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// The full audit trail for a dataset, independent of which version is
// currently active — finalizing shouldn't make earlier cleaning history
// disappear from view.
export async function getCleaningLogForDataset(datasetId: string): Promise<CleaningLogRow[]> {
  const { data, error } = await supabase
    .from("dataset_cleaning_log")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Removes the most recent log entries for one applied operation (they share
// a created_at-adjacent batch) so "Undo last operation" can revert them.
export async function deleteCleaningLogEntries(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("dataset_cleaning_log").delete().in("id", ids);
  if (error) throw error;
}
