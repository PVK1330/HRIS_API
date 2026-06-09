-- 116_exit_approvals_allow_withdraw_action.sql
-- Allow a distinct 'WITHDRAW' action in exit_approvals so a withdrawal is logged as its own
-- action rather than a generic 'COMMENT'. Extends the chk_exit_approvals_action CHECK
-- constraint added in migration 080. Idempotent (drop-if-exists then re-add).

ALTER TABLE exit_approvals
  DROP CONSTRAINT IF EXISTS chk_exit_approvals_action;

ALTER TABLE exit_approvals
  ADD CONSTRAINT chk_exit_approvals_action CHECK (action IN (
    'PENDING','APPROVE','REJECT','SEND_BACK','ESCALATE','REASSIGN','COMMENT','COMPLETE','WITHDRAW'
  ));
