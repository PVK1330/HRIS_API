-- 005_create_documents_table.sql
-- Document management and approval

CREATE TABLE IF NOT EXISTS documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    document_type       VARCHAR(100) NOT NULL, -- Passport, Emirates ID, Visa, Educational Certificate, Employment Contract, etc.
    document_title      VARCHAR(255) NOT NULL,
    document_number     VARCHAR(100),
    issue_date          DATE,
    expiry_date         DATE,
    issued_by           VARCHAR(255),
    file_url            VARCHAR(500) NOT NULL,
    file_name           VARCHAR(255) NOT NULL,
    file_size           INTEGER,
    file_mime_type      VARCHAR(100),
    version             INTEGER NOT NULL DEFAULT 1,
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected, Expired
    notes               TEXT,
    approved_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_employee_id ON documents (employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (document_type);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents (expiry_date);

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Document audit log
CREATE TABLE IF NOT EXISTS document_audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    action              VARCHAR(50) NOT NULL, -- Uploaded, Viewed, Approved, Rejected, Replaced, Deleted
    actor_id            UUID REFERENCES employees(id) ON DELETE SET NULL,
    actor_name          VARCHAR(255),
    detail              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_audit_log_document_id ON document_audit_log (document_id);
CREATE INDEX IF NOT EXISTS idx_document_audit_log_created_at ON document_audit_log (created_at);
