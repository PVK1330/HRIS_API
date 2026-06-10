-- 116: allow WITHDRAW as a distinct exit_approvals action.
-- Withdrawals were previously logged as generic COMMENT rows; recording them as a distinct
-- WITHDRAW action requires extending the chk_exit_approvals_action CHECK constraint.
ALTER TABLE exit_approvals DROP CONSTRAINT IF EXISTS chk_exit_approvals_action;
ALTER TABLE exit_approvals ADD CONSTRAINT chk_exit_approvals_action
  CHECK (action IN (
    'PENDING','APPROVE','REJECT','SEND_BACK','ESCALATE','REASSIGN','COMMENT','COMPLETE','WITHDRAW'
  ));
