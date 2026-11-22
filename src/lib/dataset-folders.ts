/** Folder layout for My Datasets. Stored in this browser. Part names stem_1, stem_2 group themselves. */

export const FOLDER_STORAGE_KEY = "ds-dataset-folders";

export type FolderDataset = { id: string; name: string };

export type FolderPrefs = {
  folders: string[];
  /** Dataset id → folder name. An empty string keeps the dataset out of its automatic part folder. */
  byId: Record<string, string>;
};

export function emptyFolderPrefs(): FolderPrefs {
  return { folders: [], byId: {} };
}

export function cleanFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60);
}

/** `sales_2` → `sales`. A name with no `_number` suffix is not a part. */
export function partGroupName(name: string): string | null {
  const match = /^(.*)_(\d+)$/.exec(name.trim());
  const stem = match?.[1]?.trim();
  if (!stem) return null;
  return stem;
}

export function resolvedFolder(dataset: FolderDataset, datasets: FolderDataset[], prefs: FolderPrefs): string | null {
  if (Object.prototype.hasOwnProperty.call(prefs.byId, dataset.id)) {
    const chosen = prefs.byId[dataset.id]?.trim() ?? "";
    return chosen || null;
  }
  const stem = partGroupName(dataset.name);
  if (!stem) return null;
  let peers = 0;
  for (const item of datasets) {
    if (Object.prototype.hasOwnProperty.call(prefs.byId, item.id)) continue;
    if (partGroupName(item.name) === stem) peers += 1;
  }
  return peers >= 2 ? stem : null;
}

export function folderSummaries(datasets: FolderDataset[], prefs: FolderPrefs): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const folder of prefs.folders) counts.set(folder, 0);
  for (const dataset of datasets) {
    const folder = resolvedFolder(dataset, datasets, prefs);
    if (!folder) continue;
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function unsortedCount(datasets: FolderDataset[], prefs: FolderPrefs): number {
  return datasets.filter((dataset) => resolvedFolder(dataset, datasets, prefs) == null).length;
}

export function isPartFolder(name: string, members: FolderDataset[]): boolean {
  return members.length >= 2 && members.every((member) => partGroupName(member.name) === name);
}

export function addFolder(prefs: FolderPrefs, name: string): FolderPrefs {
  const clean = cleanFolderName(name);
  if (!clean || prefs.folders.includes(clean)) return prefs;
  return { folders: [...prefs.folders, clean], byId: prefs.byId };
}

export function moveDataset(prefs: FolderPrefs, id: string, folder: string): FolderPrefs {
  return { folders: prefs.folders, byId: { ...prefs.byId, [id]: folder } };
}

export function renameFolder(prefs: FolderPrefs, datasets: FolderDataset[], from: string, to: string): FolderPrefs {
  const clean = cleanFolderName(to);
  if (!clean || clean === from) return prefs;
  const byId = { ...prefs.byId };
  for (const dataset of datasets) {
    if (resolvedFolder(dataset, datasets, prefs) === from) byId[dataset.id] = clean;
  }
  const folders = prefs.folders.filter((folder) => folder !== from && folder !== clean);
  folders.push(clean);
  return { folders, byId };
}

export function dissolveFolder(prefs: FolderPrefs, datasets: FolderDataset[], name: string): FolderPrefs {
  const byId = { ...prefs.byId };
  for (const dataset of datasets) {
    if (resolvedFolder(dataset, datasets, prefs) === name) byId[dataset.id] = "";
  }
  return { folders: prefs.folders.filter((folder) => folder !== name), byId };
}

export function loadFolderPrefs(): FolderPrefs {
  if (typeof localStorage === "undefined") return emptyFolderPrefs();
  try {
    const raw = localStorage.getItem(FOLDER_STORAGE_KEY);
    if (!raw) return emptyFolderPrefs();
    const parsed = JSON.parse(raw) as Partial<FolderPrefs>;
    const folders = Array.isArray(parsed.folders)
      ? parsed.folders.filter((item): item is string => typeof item === "string").map((item) => cleanFolderName(item)).filter(Boolean)
      : [];
    const byId: Record<string, string> = {};
    if (parsed.byId && typeof parsed.byId === "object") {
      for (const [id, folder] of Object.entries(parsed.byId)) {
        if (typeof folder === "string") byId[id] = folder;
      }
    }
    return { folders: [...new Set(folders)], byId };
  } catch {
    return emptyFolderPrefs();
  }
}

export function saveFolderPrefs(prefs: FolderPrefs): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(prefs));
}
