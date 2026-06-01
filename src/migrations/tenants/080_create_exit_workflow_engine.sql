-- 080_create_exit_workflow_engine.sql
-- New workflow-driven Exit Management schema (replaces the dropped legacy pipeline).
-- Dependency order: lookups -> workflows -> stages -> stage children -> requests
--                   -> approvals -> request children. One transaction.
-- Enums via CHECK constraints. New PKs BIGSERIAL; FKs to employees/departments/rbac_roles
-- are INTEGER (those PKs are SERIAL).

BEGIN;

-- ----------------------------------------------------------------------------
-- A.2.0 Lookup: termination_types (re-created)
-- ----------------------------------------------------------------------------
CREATE TABLE termination_types (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_termination_types_name UNIQUE (name)
);

-- ----------------------------------------------------------------------------
-- A.2.1 exit_workflows — workflow definition (header)
-- ----------------------------------------------------------------------------
CREATE TABLE exit_workflows (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  description   TEXT,
  exit_type     VARCHAR(32),          -- NULL = applies to all; else 'resignation'|'termination'
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  version       INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_exit_workflows_exit_type
    CHECK (exit_type IS NULL OR exit_type IN ('resignation','termination'))
);

CREATE UNIQUE INDEX uq_exit_workflows_one_default
  ON exit_workflows (COALESCE(exit_type, '*'))
  WHERE is_default = true;

CREATE INDEX idx_exit_workflows_active ON exit_workflows (is_active);

-- ----------------------------------------------------------------------------
-- A.2.2 exit_workflow_stages — ordered stages (<=6)
-- ----------------------------------------------------------------------------
CREATE TABLE exit_workflow_stages (
  id                       BIGSERIAL PRIMARY KEY,
  workflow_id              BIGINT NOT NULL
                             REFERENCES exit_workflows(id) ON DELETE CASCADE,
  name                     VARCHAR(160) NOT NULL,
  stage_order              SMALLINT NOT NULL,

  approval_mode            VARCHAR(16) NOT NULL DEFAULT 'ANY',
  quorum_count             INTEGER,

  block_until_checklist_complete BOOLEAN NOT NULL DEFAULT false,

  sla_hours                INTEGER,
  escalation_enabled       BOOLEAN NOT NULL DEFAULT false,
  escalation_after_hours   INTEGER,
  escalation_to_role_id    INTEGER REFERENCES rbac_roles(id) ON DELETE SET NULL,
  escalation_to_user_id    INTEGER REFERENCES employees(id)  ON DELETE SET NULL,
  escalation_action        VARCHAR(16) NOT NULL DEFAULT 'NOTIFY',

  allow_future_visibility  BOOLEAN NOT NULL DEFAULT false,
  allow_previous_edit      BOOLEAN NOT NULL DEFAULT false,
  mandatory_comment        BOOLEAN NOT NULL DEFAULT false,

  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_exit_workflow_stages_order UNIQUE (workflow_id, stage_order),
  CONSTRAINT chk_exit_stage_order        CHECK (stage_order BETWEEN 1 AND 6),
  CONSTRAINT chk_exit_stage_approval_mode
    CHECK (approval_mode IN ('ANY','ALL','QUORUM','SEQUENTIAL')),
  CONSTRAINT chk_exit_stage_quorum
    CHECK (approval_mode <> 'QUORUM' OR (quorum_count IS NOT NULL AND quorum_count >= 1)),
  CONSTRAINT chk_exit_stage_escalation_action
    CHECK (escalation_action IN ('NOTIFY','REASSIGN'))
);

CREATE INDEX idx_exit_workflow_stages_wf ON exit_workflow_stages (workflow_id, stage_order);

-- ----------------------------------------------------------------------------
-- A.2.3 exit_stage_departments — departments that OWN a stage
-- ----------------------------------------------------------------------------
CREATE TABLE exit_stage_departments (
  id             BIGSERIAL PRIMARY KEY,
  stage_id       BIGINT NOT NULL
                   REFERENCES exit_workflow_stages(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL
                   REFERENCES departments(id) ON DELETE CASCADE,
  is_primary     BOOLEAN NOT NULL DEFAULT false,
  approver_order SMALLINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_exit_stage_dept UNIQUE (stage_id, department_id)
);

CREATE INDEX idx_exit_stage_dept_stage ON exit_stage_departments (stage_id);
CREATE INDEX idx_exit_stage_dept_dept  ON exit_stage_departments (department_id);

-- ----------------------------------------------------------------------------
-- A.2.4 exit_stage_roles — RBAC roles authorized at a stage
-- ----------------------------------------------------------------------------
CREATE TABLE exit_stage_roles (
  id             BIGSERIAL PRIMARY KEY,
  stage_id       BIGINT NOT NULL
                   REFERENCES exit_workflow_stages(id) ON DELETE CASCADE,
  role_id        INTEGER NOT NULL
                   REFERENCES rbac_roles(id) ON DELETE CASCADE,
  approver_order SMALLINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_exit_stage_role UNIQUE (stage_id, role_id)
);

CREATE INDEX idx_exit_stage_role_stage ON exit_stage_roles (stage_id);
CREATE INDEX idx_exit_stage_role_role  ON exit_stage_roles (role_id);

-- ----------------------------------------------------------------------------
-- A.2.5 exit_stage_users — explicitly assigned approver users
-- ----------------------------------------------------------------------------
CREATE TABLE exit_stage_users (
  id             BIGSERIAL PRIMARY KEY,
  stage_id       BIGINT NOT NULL
                   REFERENCES exit_workflow_stages(id) ON DELETE CASCADE,
  employee_id    INTEGER NOT NULL
                   REFERENCES employees(id) ON DELETE CASCADE,
  approver_order SMALLINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_exit_stage_user UNIQUE (stage_id, employee_id)
);

CREATE INDEX idx_exit_stage_user_stage ON exit_stage_users (stage_id);
CREATE INDEX idx_exit_stage_user_emp   ON exit_stage_users (employee_id);

-- ----------------------------------------------------------------------------
-- A.2.6 exit_stage_checklist_items — TEMPLATE for stage-attached actions
-- ----------------------------------------------------------------------------
CREATE TABLE exit_stage_checklist_items (
  id             BIGSERIAL PRIMARY KEY,
  stage_id       BIGINT NOT NULL
                   REFERENCES exit_workflow_stages(id) ON DELETE CASCADE,
  item_type      VARCHAR(24) NOT NULL DEFAULT 'TASK',
  label          VARCHAR(200) NOT NULL,
  description    TEXT,
  is_mandatory   BOOLEAN NOT NULL DEFAULT true,
  requires_proof BOOLEAN NOT NULL DEFAULT false,
  assigned_role_id INTEGER REFERENCES rbac_roles(id) ON DELETE SET NULL,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_exit_stage_item_type
    CHECK (item_type IN ('TASK','ASSET_RETURN','INTERVIEW','SETTLEMENT','DOCUMENT'))
);

CREATE INDEX idx_exit_stage_checklist_stage ON exit_stage_checklist_items (stage_id, sort_order);

-- ----------------------------------------------------------------------------
-- A.2.7 exit_requests — the exit instance (replaces exit_records)
-- ----------------------------------------------------------------------------
CREATE TABLE exit_requests (
  id                          BIGSERIAL PRIMARY KEY,
  employee_id                 INTEGER NOT NULL
                                REFERENCES employees(id) ON DELETE CASCADE,
  exit_type                   VARCHAR(32) NOT NULL DEFAULT 'resignation',
  termination_type_id         BIGINT REFERENCES termination_types(id) ON DELETE SET NULL,

  workflow_id                 BIGINT REFERENCES exit_workflows(id) ON DELETE SET NULL,
  current_stage_id            BIGINT REFERENCES exit_workflow_stages(id) ON DELETE SET NULL,
  current_owner_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  status                      VARCHAR(24) NOT NULL DEFAULT 'DRAFT',

  stage_entered_at            TIMESTAMPTZ,

  exit_reason                 TEXT,
  reason_detail               TEXT,
  notice_date                 DATE,
  resignation_date            DATE,
  last_working_day            DATE,
  notice_period_days          INTEGER,
  is_voluntary                BOOLEAN,
  initiated_by                INTEGER REFERENCES employees(id) ON DELETE SET NULL,

  rejection_reason            TEXT,
  withdrawal_status           VARCHAR(16),
  withdrawal_reason           TEXT,
  withdrawal_requested_at     TIMESTAMPTZ,

  submitted_at                TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_exit_requests_status CHECK (status IN (
    'DRAFT','SUBMITTED','IN_PROGRESS','COMPLETED','REJECTED','WITHDRAWN','CANCELLED'
  )),
  CONSTRAINT chk_exit_requests_exit_type
    CHECK (exit_type IN ('resignation','termination')),
  CONSTRAINT chk_exit_requests_withdrawal_status
    CHECK (withdrawal_status IS NULL
           OR withdrawal_status IN ('requested','approved','rejected'))
);

CREATE INDEX idx_exit_requests_employee      ON exit_requests (employee_id);
CREATE INDEX idx_exit_requests_workflow      ON exit_requests (workflow_id);
CREATE INDEX idx_exit_requests_current_stage ON exit_requests (current_stage_id);
CREATE INDEX idx_exit_requests_owner_dept    ON exit_requests (current_owner_department_id);
CREATE INDEX idx_exit_requests_status        ON exit_requests (status);

-- ----------------------------------------------------------------------------
-- A.2.8 exit_approvals — per-stage approval/action log
-- ----------------------------------------------------------------------------
CREATE TABLE exit_approvals (
  id              BIGSERIAL PRIMARY KEY,
  exit_request_id BIGINT NOT NULL
                    REFERENCES exit_requests(id) ON DELETE CASCADE,
  stage_id        BIGINT NOT NULL
                    REFERENCES exit_workflow_stages(id) ON DELETE CASCADE,
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  assigned_user_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action          VARCHAR(20) NOT NULL,
  actor_id        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  actor_name      VARCHAR(160),
  comments        TEXT,

  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sla_due_at       TIMESTAMPTZ,
  acted_at         TIMESTAMPTZ,
  is_sla_breached  BOOLEAN NOT NULL DEFAULT false,
  escalated_at     TIMESTAMPTZ,

  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_exit_approvals_action CHECK (action IN (
    'PENDING','APPROVE','REJECT','SEND_BACK','ESCALATE','REASSIGN','COMMENT','COMPLETE'
  ))
);

CREATE INDEX idx_exit_approvals_request ON exit_approvals (exit_request_id);
CREATE INDEX idx_exit_approvals_stage   ON exit_approvals (stage_id);
CREATE INDEX idx_exit_approvals_actor   ON exit_approvals (actor_id);
CREATE INDEX idx_exit_approvals_pending_user
  ON exit_approvals (exit_request_id, stage_id, assigned_user_id)
  WHERE action = 'PENDING';
CREATE INDEX idx_exit_approvals_sla_open
  ON exit_approvals (sla_due_at)
  WHERE action = 'PENDING' AND is_sla_breached = false;

-- ----------------------------------------------------------------------------
-- A.2.10 exit_request_checklist_items — per-request INSTANCE of stage actions
--   (created before attachments so the attachments FK can reference it)
-- ----------------------------------------------------------------------------
CREATE TABLE exit_request_checklist_items (
  id               BIGSERIAL PRIMARY KEY,
  exit_request_id  BIGINT NOT NULL
                     REFERENCES exit_requests(id) ON DELETE CASCADE,
  stage_id         BIGINT NOT NULL
                     REFERENCES exit_workflow_stages(id) ON DELETE CASCADE,
  template_item_id BIGINT REFERENCES exit_stage_checklist_items(id) ON DELETE SET NULL,
  item_type        VARCHAR(24) NOT NULL DEFAULT 'TASK',
  label            VARCHAR(200) NOT NULL,
  is_mandatory     BOOLEAN NOT NULL DEFAULT true,
  status           VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  assigned_to      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  completed_by     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  due_date         DATE,
  notes            TEXT,
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_exit_req_item_type
    CHECK (item_type IN ('TASK','ASSET_RETURN','INTERVIEW','SETTLEMENT','DOCUMENT')),
  CONSTRAINT chk_exit_req_item_status
    CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','SKIPPED','NA'))
);

CREATE INDEX idx_exit_req_item_request ON exit_request_checklist_items (exit_request_id);
CREATE INDEX idx_exit_req_item_stage   ON exit_request_checklist_items (exit_request_id, stage_id);
CREATE INDEX idx_exit_req_item_status  ON exit_request_checklist_items (status);

-- ----------------------------------------------------------------------------
-- A.2.9 exit_request_attachments — files attached to a request (any stage)
-- ----------------------------------------------------------------------------
CREATE TABLE exit_request_attachments (
  id              BIGSERIAL PRIMARY KEY,
  exit_request_id BIGINT NOT NULL
                    REFERENCES exit_requests(id) ON DELETE CASCADE,
  stage_id        BIGINT REFERENCES exit_workflow_stages(id) ON DELETE SET NULL,
  checklist_item_id BIGINT REFERENCES exit_request_checklist_items(id) ON DELETE SET NULL,
  attachment_type VARCHAR(24) NOT NULL DEFAULT 'GENERIC',
  file_url        TEXT NOT NULL,
  file_name       VARCHAR(255),
  mime_type       VARCHAR(120),
  uploaded_by     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_exit_attachment_type
    CHECK (attachment_type IN ('GENERIC','PROOF','GENERATED_DOC'))
);

CREATE INDEX idx_exit_attach_request ON exit_request_attachments (exit_request_id);
CREATE INDEX idx_exit_attach_stage   ON exit_request_attachments (stage_id);

COMMIT;
