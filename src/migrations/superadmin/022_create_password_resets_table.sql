-- 022_create_password_resets_table.sql
-- Create a central table to hold password resets for admins and employees

CREATE TABLE IF NOT EXISTS public.password_resets (
    id           SERIAL PRIMARY KEY,
    email        VARCHAR(255) NOT NULL,
    tenant_id    INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_type    VARCHAR(50) NOT NULL, -- 'admin' or 'employee'
    otp_code     VARCHAR(6) NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email ON public.password_resets (email);
