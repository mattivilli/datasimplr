-- Bug fix, not a redesign: the original version of a multi-sheet Excel
-- upload never recorded which sheet was selected, so reopening it (Analyzer,
-- Download, or Phase 2's quality workspace) silently fell back to the
-- workbook's first sheet. This just adds the missing pointer.
ALTER TABLE public.dataset_versions ADD COLUMN sheet_name TEXT;
