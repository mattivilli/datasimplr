-- Phase 4: plans + usage limits, Razorpay payments, reverse trial, teams.
--
-- Additive, with one deliberate exception: the "*_own" FOR ALL policies on
-- datasets / dataset_versions / dataset_cleaning_log / analyses are replaced
-- by per-command policies, so teammates can READ rows shared to their team
-- and so dataset inserts can enforce plan quotas. Owners keep exactly the
-- access they had before.
--
-- Payment and plan rows (subscriptions, report_credits, usage_events) are
-- written only by the server (service_role) or by SECURITY DEFINER functions
-- below; signed-in users can read their own but never write them.

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------

CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  owner_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON public.team_members (user_id);

CREATE TABLE public.team_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  -- 256 bits of randomness without depending on the pgcrypto schema location.
  token TEXT NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users ON DELETE SET NULL
);
-- One pending invite per email per team.
CREATE UNIQUE INDEX team_invites_pending_idx ON public.team_invites (team_id, email) WHERE accepted_at IS NULL;

CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SECURITY DEFINER so policies on team_members can call these without
-- recursing into team_members' own RLS.
CREATE OR REPLACE FUNCTION public.is_team_member(_team UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = _team AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_team_admin(_team UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = _team AND user_id = auth.uid() AND role IN ('owner', 'admin')
  );
$$;

-- The creator of a team is always its owner member.
CREATE OR REPLACE FUNCTION public.handle_new_team() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role) VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_team() FROM anon, authenticated, PUBLIC;
CREATE TRIGGER on_team_created AFTER INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION public.handle_new_team();

-- ---------------------------------------------------------------------------
-- Subscriptions (paid periods + trials), report credits, usage events
-- ---------------------------------------------------------------------------

-- One row per paid period or trial. Razorpay payments are one-time (UPI
-- friendly), so each purchase appends a row covering period_start..period_end.
CREATE TABLE public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('plus', 'pro', 'team')),
  source TEXT NOT NULL CHECK (source IN ('trial', 'razorpay', 'manual')),
  billing_interval TEXT CHECK (billing_interval IN ('month', 'year')),
  seats INTEGER CHECK (seats IS NULL OR seats > 0),
  period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_end TIMESTAMPTZ NOT NULL,
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  amount INTEGER,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((plan = 'team') = (team_id IS NOT NULL)),
  CHECK (period_end > period_start)
);
CREATE INDEX subscriptions_user_idx ON public.subscriptions (user_id, period_end DESC);
CREATE INDEX subscriptions_team_idx ON public.subscriptions (team_id, period_end DESC) WHERE team_id IS NOT NULL;

-- One-time "Report Pass": unlocks one saved analysis (full findings + clean export).
CREATE TABLE public.report_credits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  analysis_id UUID REFERENCES public.analyses ON DELETE SET NULL,
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  amount INTEGER,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);
CREATE INDEX report_credits_user_idx ON public.report_credits (user_id, consumed_at);
CREATE UNIQUE INDEX report_credits_analysis_idx ON public.report_credits (analysis_id) WHERE analysis_id IS NOT NULL;

-- Append-only usage counter. Deleting a dataset does not give an upload back.
CREATE TABLE public.usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_user_idx ON public.usage_events (user_id, kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- Plan resolution + limits. Keep in sync with src/lib/plans.ts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.plan_limits(_plan TEXT)
RETURNS TABLE (monthly_uploads INTEGER, max_file_bytes BIGINT, storage_bytes BIGINT)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT v.monthly_uploads, v.max_file_bytes, v.storage_bytes FROM (VALUES
    ('free', 3,    5::bigint  * 1024 * 1024, 100::bigint * 1024 * 1024),
    ('plus', 30,   20::bigint * 1024 * 1024, 2::bigint   * 1024 * 1024 * 1024),
    ('pro',  NULL, 50::bigint * 1024 * 1024, 10::bigint  * 1024 * 1024 * 1024),
    ('team', NULL, 50::bigint * 1024 * 1024, 10::bigint  * 1024 * 1024 * 1024)
  ) AS v(plan, monthly_uploads, max_file_bytes, storage_bytes)
  WHERE v.plan = _plan;
$$;

-- The best plan currently covering the caller: their own plus/pro period or
-- any team plan of a team they belong to.
CREATE OR REPLACE FUNCTION public.my_active_subscription() RETURNS SETOF public.subscriptions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.* FROM public.subscriptions s
  WHERE s.period_start <= now() AND s.period_end > now()
    AND (
      (s.team_id IS NULL AND s.user_id = auth.uid())
      OR s.team_id IN (SELECT tm.team_id FROM public.team_members tm WHERE tm.user_id = auth.uid())
    )
  ORDER BY CASE s.plan WHEN 'team' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC, s.period_end DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.my_plan() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT plan FROM public.my_active_subscription()), 'free');
$$;

-- Real bytes in the caller's storage folder (the object metadata, not the
-- client-reported file_size), so direct Storage uploads count too.
CREATE OR REPLACE FUNCTION public.my_storage_bytes() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)::bigint
  FROM storage.objects o
  WHERE o.bucket_id = 'datasets' AND o.name LIKE auth.uid()::text || '/%';
$$;

CREATE OR REPLACE FUNCTION public.my_uploads_this_month() RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int FROM public.usage_events
  WHERE user_id = auth.uid() AND kind = 'dataset_upload' AND created_at >= date_trunc('month', now());
$$;

-- NULL = allowed; otherwise a reason code the UI turns into an upgrade prompt.
CREATE OR REPLACE FUNCTION public.check_dataset_quota(_file_size BIGINT) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lim RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 'not_signed_in'; END IF;
  SELECT * INTO lim FROM public.plan_limits(public.my_plan());
  IF _file_size IS NOT NULL AND _file_size > lim.max_file_bytes THEN RETURN 'file_too_large'; END IF;
  IF lim.monthly_uploads IS NOT NULL AND public.my_uploads_this_month() >= lim.monthly_uploads THEN
    RETURN 'monthly_limit';
  END IF;
  IF public.my_storage_bytes() + COALESCE(_file_size, 0) > lim.storage_bytes THEN RETURN 'storage_full'; END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.get_entitlements() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sub public.subscriptions;
  _plan TEXT;
  lim RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO sub FROM public.my_active_subscription();
  _plan := COALESCE(sub.plan, 'free');
  SELECT * INTO lim FROM public.plan_limits(_plan);
  RETURN jsonb_build_object(
    'plan', _plan,
    'source', sub.source,
    'team_id', sub.team_id,
    'period_end', sub.period_end,
    'trial_available', NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = auth.uid() AND team_id IS NULL),
    'team_trial_available', NOT EXISTS (
      SELECT 1 FROM public.subscriptions WHERE user_id = auth.uid() AND team_id IS NOT NULL AND source = 'trial'
    ),
    'limits', jsonb_build_object(
      'monthly_uploads', lim.monthly_uploads,
      'max_file_bytes', lim.max_file_bytes,
      'storage_bytes', lim.storage_bytes
    ),
    'usage', jsonb_build_object(
      'uploads_this_month', public.my_uploads_this_month(),
      'storage_bytes', public.my_storage_bytes()
    ),
    'report_credits', (SELECT COUNT(*) FROM public.report_credits WHERE user_id = auth.uid() AND consumed_at IS NULL)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Reverse trial: 7 days of Pro, once per account.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user_trial() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, source, period_end)
  VALUES (NEW.id, 'pro', 'trial', now() + interval '7 days');
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_trial() FROM anon, authenticated, PUBLIC;
CREATE TRIGGER on_auth_user_created_trial AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_trial();

-- Existing accounts get the same 7-day Pro trial as new signups, so applying
-- this migration never drops current users straight onto Free limits.
INSERT INTO public.subscriptions (user_id, plan, source, period_end)
SELECT u.id, 'pro', 'trial', now() + interval '7 days'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.team_id IS NULL);

-- Fallback for any account that somehow has no trial row yet.
CREATE OR REPLACE FUNCTION public.start_trial() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = auth.uid() AND team_id IS NULL) THEN
    RAISE EXCEPTION 'trial_unavailable';
  END IF;
  INSERT INTO public.subscriptions (user_id, plan, source, period_end)
  VALUES (auth.uid(), 'pro', 'trial', now() + interval '7 days');
  RETURN public.get_entitlements();
END; $$;

-- One 14-day, 3-seat team trial per user (so new teams can't farm trials).
CREATE OR REPLACE FUNCTION public.start_team_trial(_team UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_team_admin(_team) THEN RAISE EXCEPTION 'not_team_admin'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = auth.uid() AND team_id IS NOT NULL AND source = 'trial')
     OR EXISTS (SELECT 1 FROM public.subscriptions WHERE team_id = _team) THEN
    RAISE EXCEPTION 'trial_unavailable';
  END IF;
  INSERT INTO public.subscriptions (user_id, team_id, plan, source, seats, period_end)
  VALUES (auth.uid(), _team, 'team', 'trial', 3, now() + interval '14 days');
END; $$;

-- ---------------------------------------------------------------------------
-- Team seats, invites, roster
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.team_seats_available(_team UUID) RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT s.seats FROM public.subscriptions s
    WHERE s.team_id = _team AND s.period_start <= now() AND s.period_end > now()
    ORDER BY s.seats DESC NULLS LAST LIMIT 1
  ), 0)
  - (SELECT COUNT(*) FROM public.team_members WHERE team_id = _team)::int
  - (SELECT COUNT(*) FROM public.team_invites WHERE team_id = _team AND accepted_at IS NULL AND expires_at > now())::int;
$$;

-- Safe preview for the invite landing page: no emails of other members.
CREATE OR REPLACE FUNCTION public.get_invite(_token TEXT)
RETURNS TABLE (team_name TEXT, inviter_name TEXT, email TEXT, role TEXT, expired BOOLEAN, accepted BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, COALESCE(p.display_name, 'A teammate'), i.email, i.role,
         i.expires_at <= now(), i.accepted_at IS NOT NULL
  FROM public.team_invites i
  JOIN public.teams t ON t.id = i.team_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by
  WHERE i.token = _token;
$$;

CREATE OR REPLACE FUNCTION public.accept_team_invite(_token TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.team_invites;
  caller_email TEXT := lower(COALESCE(auth.jwt()->>'email', ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO inv FROM public.team_invites WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF inv.accepted_at IS NOT NULL THEN
    IF inv.accepted_by = auth.uid() THEN RETURN inv.team_id; END IF;
    RAISE EXCEPTION 'invite_used';
  END IF;
  IF inv.expires_at <= now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  IF inv.email <> caller_email THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;

  INSERT INTO public.team_members (team_id, user_id, role) VALUES (inv.team_id, auth.uid(), inv.role)
  ON CONFLICT (team_id, user_id) DO NOTHING;
  UPDATE public.team_invites SET accepted_at = now(), accepted_by = auth.uid() WHERE id = inv.id;
  RETURN inv.team_id;
END; $$;

CREATE OR REPLACE FUNCTION public.team_roster(_team UUID)
RETURNS TABLE (user_id UUID, role TEXT, display_name TEXT, email TEXT, joined_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id, m.role, COALESCE(p.display_name, split_part(u.email, '@', 1)), u.email::text, m.created_at
  FROM public.team_members m
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.team_id = _team AND public.is_team_member(_team)
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Report Pass redemption
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_report_credit(_analysis UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  credit_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.analyses WHERE id = _analysis AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'analysis_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.report_credits WHERE analysis_id = _analysis) THEN RETURN; END IF;
  SELECT id INTO credit_id FROM public.report_credits
  WHERE user_id = auth.uid() AND consumed_at IS NULL
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF credit_id IS NULL THEN RAISE EXCEPTION 'no_report_credits'; END IF;
  UPDATE public.report_credits SET analysis_id = _analysis, consumed_at = now() WHERE id = credit_id;
END; $$;

-- ---------------------------------------------------------------------------
-- Sharing: datasets and analyses can belong to a team
-- ---------------------------------------------------------------------------

ALTER TABLE public.datasets ADD COLUMN team_id UUID REFERENCES public.teams ON DELETE SET NULL;
CREATE INDEX datasets_team_idx ON public.datasets (team_id, updated_at DESC) WHERE team_id IS NOT NULL;
ALTER TABLE public.analyses ADD COLUMN team_id UUID REFERENCES public.teams ON DELETE SET NULL;
CREATE INDEX analyses_team_idx ON public.analyses (team_id, created_at DESC) WHERE team_id IS NOT NULL;
-- Storage read policy for teammates looks versions up by object key.
CREATE INDEX dataset_versions_storage_key_idx ON public.dataset_versions (storage_key);

CREATE OR REPLACE FUNCTION public.can_read_dataset(_dataset UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.datasets d
    WHERE d.id = _dataset
      AND (d.user_id = auth.uid() OR (d.team_id IS NOT NULL AND public.is_team_member(d.team_id)))
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_dataset_usage() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.usage_events (user_id, kind) VALUES (NEW.user_id, 'dataset_upload');
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_dataset_usage() FROM anon, authenticated, PUBLIC;
CREATE TRIGGER datasets_usage AFTER INSERT ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.handle_dataset_usage();

-- datasets
DROP POLICY "datasets_own" ON public.datasets;
CREATE POLICY "datasets_select" ON public.datasets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR (team_id IS NOT NULL AND public.is_team_member(team_id)));
CREATE POLICY "datasets_insert" ON public.datasets FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (team_id IS NULL OR public.is_team_member(team_id))
    AND public.check_dataset_quota(file_size) IS NULL
  );
CREATE POLICY "datasets_update" ON public.datasets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (team_id IS NULL OR public.is_team_member(team_id)));
CREATE POLICY "datasets_delete" ON public.datasets FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- dataset_versions
DROP POLICY "dataset_versions_own" ON public.dataset_versions;
CREATE POLICY "dataset_versions_select" ON public.dataset_versions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_dataset(dataset_id));
CREATE POLICY "dataset_versions_insert" ON public.dataset_versions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dataset_versions_update" ON public.dataset_versions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dataset_versions_delete" ON public.dataset_versions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- dataset_cleaning_log
DROP POLICY "dataset_cleaning_log_own" ON public.dataset_cleaning_log;
CREATE POLICY "dataset_cleaning_log_select" ON public.dataset_cleaning_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_dataset(dataset_id));
CREATE POLICY "dataset_cleaning_log_insert" ON public.dataset_cleaning_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dataset_cleaning_log_update" ON public.dataset_cleaning_log FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dataset_cleaning_log_delete" ON public.dataset_cleaning_log FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- analyses
DROP POLICY "analyses_own" ON public.analyses;
CREATE POLICY "analyses_select" ON public.analyses FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR (team_id IS NOT NULL AND public.is_team_member(team_id)));
CREATE POLICY "analyses_insert" ON public.analyses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (team_id IS NULL OR public.is_team_member(team_id)));
CREATE POLICY "analyses_update" ON public.analyses FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (team_id IS NULL OR public.is_team_member(team_id)));
CREATE POLICY "analyses_delete" ON public.analyses FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: hard per-file cap, storage quota on upload, teammate reads
-- ---------------------------------------------------------------------------

-- Largest file any plan allows; per-plan limits are enforced by
-- check_dataset_quota. 50 MB also matches the in-browser parser's cap.
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'datasets';

DROP POLICY "dataset_files_insert_own" ON storage.objects;
CREATE POLICY "dataset_files_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'datasets'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.my_storage_bytes() < (SELECT storage_bytes FROM public.plan_limits(public.my_plan()))
  );

CREATE POLICY "dataset_files_select_team" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'datasets'
    AND EXISTS (
      SELECT 1 FROM public.dataset_versions v
      WHERE v.storage_key = storage.objects.name AND public.can_read_dataset(v.dataset_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Grants + RLS for the new tables
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.team_invites TO authenticated;
GRANT SELECT ON public.subscriptions, public.report_credits, public.usage_events TO authenticated;
GRANT ALL ON public.teams, public.team_members, public.team_invites, public.subscriptions,
  public.report_credits, public.usage_events TO service_role;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_select" ON public.teams FOR SELECT TO authenticated USING (public.is_team_member(id));
CREATE POLICY "teams_insert" ON public.teams FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "teams_update" ON public.teams FOR UPDATE TO authenticated
  USING (public.is_team_admin(id)) WITH CHECK (public.is_team_admin(id));
CREATE POLICY "teams_delete" ON public.teams FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "team_members_select" ON public.team_members FOR SELECT TO authenticated USING (public.is_team_member(team_id));
-- Admins remove members; anyone can leave. The owner can do neither.
CREATE POLICY "team_members_delete" ON public.team_members FOR DELETE TO authenticated
  USING (role <> 'owner' AND (public.is_team_admin(team_id) OR user_id = auth.uid()));
CREATE POLICY "team_members_update" ON public.team_members FOR UPDATE TO authenticated
  USING (role <> 'owner' AND public.is_team_admin(team_id))
  WITH CHECK (role IN ('admin', 'member') AND public.is_team_admin(team_id));

CREATE POLICY "team_invites_select" ON public.team_invites FOR SELECT TO authenticated USING (public.is_team_admin(team_id));
CREATE POLICY "team_invites_insert" ON public.team_invites FOR INSERT TO authenticated
  WITH CHECK (invited_by = auth.uid() AND public.is_team_admin(team_id) AND public.team_seats_available(team_id) > 0);
CREATE POLICY "team_invites_delete" ON public.team_invites FOR DELETE TO authenticated USING (public.is_team_admin(team_id));

CREATE POLICY "subscriptions_select" ON public.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (team_id IS NOT NULL AND public.is_team_member(team_id)));
CREATE POLICY "report_credits_select" ON public.report_credits FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "usage_events_select" ON public.usage_events FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Functions callable by signed-in users (policies need EXECUTE too).
REVOKE EXECUTE ON FUNCTION
  public.is_team_member(UUID), public.is_team_admin(UUID), public.my_active_subscription(), public.my_plan(),
  public.my_storage_bytes(), public.my_uploads_this_month(), public.check_dataset_quota(BIGINT),
  public.get_entitlements(), public.start_trial(), public.start_team_trial(UUID), public.team_seats_available(UUID),
  public.accept_team_invite(TEXT), public.team_roster(UUID), public.redeem_report_credit(UUID),
  public.can_read_dataset(UUID)
FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.is_team_member(UUID), public.is_team_admin(UUID), public.my_active_subscription(), public.my_plan(),
  public.my_storage_bytes(), public.my_uploads_this_month(), public.check_dataset_quota(BIGINT),
  public.get_entitlements(), public.start_trial(), public.start_team_trial(UUID), public.team_seats_available(UUID),
  public.accept_team_invite(TEXT), public.team_roster(UUID), public.redeem_report_credit(UUID),
  public.can_read_dataset(UUID), public.plan_limits(TEXT), public.get_invite(TEXT)
TO authenticated;
-- The invite landing page previews the team before the visitor signs in.
GRANT EXECUTE ON FUNCTION public.get_invite(TEXT) TO anon;
