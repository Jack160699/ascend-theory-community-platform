-- COD approve/hold/reject failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification": the RPCs use ON CONFLICT (phone_normalized), which Postgres can't match to the
-- partial unique index. A plain unique constraint works (NULL phones stay allowed, NULLs are distinct).
DROP INDEX IF EXISTS public.idx_cod_risk_profiles_phone;
ALTER TABLE public.cod_risk_profiles ADD CONSTRAINT cod_risk_profiles_phone_normalized_key UNIQUE (phone_normalized);
