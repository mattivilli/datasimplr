-- Phase 1: dataset persistence foundation.
-- A dataset is the persistent identity of an uploaded file; a dataset_version
-- is one stored copy of it (original today, cleaned/finalized in a later
-- phase). The actual bytes live in Supabase Storage (private "datasets"
-- bucket); these tables hold only metadata + a storage_key pointer.

CREATE TABLE public.datasets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  original_filename TEXT,
  file_type TEXT NOT NULL DEFAULT 'csv',
  file_size BIGINT,
  row_count INTEGER,
  column_count INTEGER,
  current_version_id UUID,
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "datasets_own" ON public.datasets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX datasets_user_idx ON public.datasets (user_id, updated_at DESC);

CREATE TABLE public.dataset_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'original',
  storage_key TEXT NOT NULL,
  row_count INTEGER,
  column_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_versions TO authenticated;
GRANT ALL ON public.dataset_versions TO service_role;
ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dataset_versions_own" ON public.dataset_versions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX dataset_versions_dataset_idx ON public.dataset_versions (dataset_id, version_number DESC);

ALTER TABLE public.datasets
  ADD CONSTRAINT datasets_current_version_fkey FOREIGN KEY (current_version_id) REFERENCES public.dataset_versions(id) ON DELETE SET NULL;

CREATE TRIGGER datasets_updated_at BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Private storage bucket for the actual dataset files. Never made public;
-- every read/write is scoped to the requesting user's own folder below.
INSERT INTO storage.buckets (id, name, public)
VALUES ('datasets', 'datasets', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are stored at {user_id}/{dataset_id}/{version_id}/{filename}, so
-- the first path segment is always the owner's auth uid.
CREATE POLICY "dataset_files_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'datasets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "dataset_files_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'datasets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "dataset_files_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'datasets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "dataset_files_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'datasets' AND (storage.foldername(name))[1] = auth.uid()::text);
