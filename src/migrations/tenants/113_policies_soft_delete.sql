-- 113_policies_soft_delete.sql
-- Soft-delete (archive) for policies. Hard DELETE used to cascade away
-- policy_acknowledgements — destroying compliance history. Instead we set
-- archived_at and keep the row (and its acknowledgements) forever.
--
-- Archived policies are hidden from every normal read path (admin list/get,
-- My Policies, audience resolution) and from the future reminder crons via the
-- `archived_at IS NULL` predicate. The partial index below is exactly the shape
-- those queries (and P3's "published + active" reminder scan) filter on.
-- Additive + idempotent.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_policies_active_status
  ON policies(status) WHERE archived_at IS NULL;
