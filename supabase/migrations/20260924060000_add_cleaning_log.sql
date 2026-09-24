-- Phase 2: cleaning log + quality score, built on top of the Phase 1
-- datasets/dataset_versions tables (unchanged, not redesigned).

ALTER TABLE public.dataset_versions ADD COLUMN quality_score INTEGER;

CREATE TABLE public.dataset_cleaning_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets ON DELETE CASCADE,
  dataset_version_id UUID NOT NULL REFERENCES public.dataset_versions ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  row_reference TEXT,
  column_name TEXT,
  original_value TEXT,
  new_value TEXT,
  operation TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_cleaning_log TO authenticated;
GRANT ALL ON public.dataset_cleaning_log TO service_role;
ALTER TABLE public.dataset_cleaning_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dataset_cleaning_log_own" ON public.dataset_cleaning_log FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX dataset_cleaning_log_version_idx ON public.dataset_cleaning_log (dataset_version_id, created_at);
