-- Phase 3: let a chat session remember which saved dataset / version / sheet
-- it was analysing. All three columns are nullable, so every existing
-- conversation (and every chat started without a dataset) is unaffected, and
-- the existing conversations_own RLS policy still governs the row.
ALTER TABLE public.conversations
  ADD COLUMN dataset_id UUID REFERENCES public.datasets ON DELETE SET NULL,
  ADD COLUMN dataset_version_id UUID REFERENCES public.dataset_versions ON DELETE SET NULL,
  ADD COLUMN sheet_name TEXT;
