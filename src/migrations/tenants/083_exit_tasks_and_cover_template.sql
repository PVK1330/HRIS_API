-- 083_exit_tasks_and_cover_template.sql
-- (1) exit_tasks — dedicated, assignable tasks raised when an exit request enters a stage.
--     A task is assigned to a "responsible person" (an explicit stage user, or an owning
--     department's head). Complements the PENDING exit_approvals slot (which also carries an
--     assigned_user_id), giving each responsible person a concrete, checkable to-do.
-- (2) seed an Exit-category letter template used as the COVER EMAIL body when exit documents
--     are emailed (so that wording is template-driven, not hard-coded).

CREATE TABLE IF NOT EXISTS exit_tasks (
  id               BIGSERIAL PRIMARY KEY,
  exit_request_id  BIGINT NOT NULL REFERENCES exit_requests(id) ON DELETE CASCADE,
  stage_id         BIGINT REFERENCES exit_workflow_stages(id) ON DELETE SET NULL,
  assigned_to      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | COMPLETED | CLOSED
  due_at           TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  completed_by     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT chk_exit_task_status CHECK (status IN ('PENDING','COMPLETED','CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_exit_tasks_assignee ON exit_tasks (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_exit_tasks_request  ON exit_tasks (exit_request_id);
CREATE INDEX IF NOT EXISTS idx_exit_tasks_stage    ON exit_tasks (stage_id);

-- Cover-email letter template (only if one with this name does not already exist).
INSERT INTO letter_templates (name, type, category, description, body, status)
SELECT 'Exit Documents Cover',
       'Letter',
       'Exit',
       'Email body used when exit documents are emailed to an employee',
       '<p>Dear {{employee_name}},</p>'
       || '<p>Please find attached your exit document(s) from {{company_name}}:</p>'
       || '<ul>{{document_list}}</ul>'
       || '<p>If you have any questions, please contact the HR department.</p>'
       || '<p>Regards,<br/>{{company_name}} HR</p>',
       'Active'
WHERE NOT EXISTS (
  SELECT 1 FROM letter_templates WHERE name = 'Exit Documents Cover'
);
