-- 112_policies_versioning_and_reack.sql
-- Close the policy acknowledgement lifecycle:
--   * content_version  — monotonic version of the policy BODY (content + attachments + file).
--                        Bumped when a published policy materially changes or an admin
--                        explicitly requires re-acknowledgement.
--   * content_hash     — fingerprint of the body, used to auto-detect material changes.
--   * published_at     — when the CURRENT version was (re)published; baseline for reminders.
--   * acknowledged_version on acks — which body version an employee acknowledged. An ack is
--                        "current" only when acknowledged_version = policies.content_version,
--                        so a version bump makes prior acks count as Pending again WITHOUT
--                        deleting compliance history.
-- Additive + idempotent (safe to re-run).

ALTER TABLE policies ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS content_hash    TEXT;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS published_at    TIMESTAMP;

ALTER TABLE policy_acknowledgements ADD COLUMN IF NOT EXISTS acknowledged_version INTEGER;

-- Backfill: every existing acknowledgement was made against the first/only version.
UPDATE policy_acknowledgements SET acknowledged_version = 1 WHERE acknowledged_version IS NULL;

-- Backfill: give already-published policies a published_at baseline.
UPDATE policies SET published_at = COALESCE(published_at, updated_at) WHERE status = 'Published';

CREATE INDEX IF NOT EXISTS idx_policy_acks_version
  ON policy_acknowledgements(policy_id, acknowledged_version);
