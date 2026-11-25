export class EmptyDatasetError extends Error {
  override readonly name = "EmptyDatasetError";
}

/** Refuses to store a dataset with nothing in it. Runs before any upload or quota prompt. */
export function assertSavable(params: { file: File | null | undefined; name: string; rowCount: number; columnCount: number }): void {
  if (!params.name || !params.name.trim()) {
    throw new EmptyDatasetError("Give the dataset a name before saving it.");
  }
  if (!params.file || params.file.size === 0) {
    throw new EmptyDatasetError("This file is empty, so there is nothing to save. Upload a file that contains data.");
  }
  if (!(params.columnCount > 0)) {
    throw new EmptyDatasetError("This dataset has no columns, so there is nothing to save.");
  }
  if (!(params.rowCount > 0)) {
    throw new EmptyDatasetError("This dataset has no data rows, so there is nothing to save. A header row alone is not enough.");
  }
}

/** The same data is already saved. Carries the saved copy so the app can point to it. */
export class DuplicateDatasetError extends Error {
  override readonly name = "DuplicateDatasetError";
  readonly existing: { id: string; name: string };
  constructor(existing: { id: string; name: string }) {
    super(`\u201c${existing.name}\u201d already has this exact data saved in My Datasets, so it was not saved again.`);
    this.existing = existing;
  }
}
