import { supabase } from "@/integrations/supabase/client";
import { parseUploadedFile } from "./parse-file";
import type { Table } from "./analysis";
import type { Tables } from "@/integrations/supabase/types";

export const DATASET_BUCKET = "datasets";

export type DatasetRow = Tables<"datasets">;
export type DatasetVersionRow = Tables<"dataset_versions">;

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
async function downloadVersionBlob(version: DatasetVersionRow): Promise<Blob> {
  const { data, error } = await supabase.storage.from(DATASET_BUCKET).download(version.storage_key);
  if (error) throw error;
  return data;
}

export async function loadDatasetTable(
  dataset: DatasetRow,
  version: DatasetVersionRow,
): Promise<{ table: Table; sourceName: string; file: File }> {
  const blob = await downloadVersionBlob(version);
  const filename = dataset.original_filename ?? `${dataset.name}.csv`;
  const file = new File([blob], filename, { type: blob.type });
  const parsed = await parseUploadedFile(file);
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
