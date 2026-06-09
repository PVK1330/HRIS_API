-- 114_policy_ack_reminders.sql
-- Scheduling/clock table for pending-acknowledgement reminders (P3).
-- TIMING + AUDIT ONLY: a row exists while an employee has an open "pending"
-- episode for a policy. Acknowledgement status itself stays version-computed
-- (policy_acknowledgements.acknowledged_version vs policies.content_version) —
-- these rows never decide whether something is acknowledged.
--
--   first_pending_at : when the current pending episode began (set on publish /
--                      version-bump / hire enrolment, or first cron sighting).
--   last_reminded_at : last reminder sent (NULL = none yet) — caps reminder
--                      frequency within the cadence window.
-- Rows are removed when the employee acknowledges the current version; the cron
-- skips archived policies (policies.archived_at IS NULL). Additive + idempotent.

CREATE TABLE IF NOT EXISTS policy_ack_reminders (
  policy_id        INTEGER   NOT NULL REFERENCES policies(id)  ON DELETE CASCADE,
  employee_id      INTEGER   NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  first_pending_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_reminded_at TIMESTAMP,
  PRIMARY KEY (policy_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_ack_reminders_due
  ON policy_ack_reminders(first_pending_at);
