CREATE TABLE IF NOT EXISTS public.tenants (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    db_name      VARCHAR(63)  UNIQUE NOT NULL,
    admin_email  VARCHAR(255) UNIQUE NOT NULL,
    status       VARCHAR(32)  NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended')),
    created_by   INTEGER REFERENCES public.superadmins(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_admin_email ON public.tenants (admin_email);
CREATE INDEX IF NOT EXISTS idx_tenants_db_name     ON public.tenants (db_name);
CREATE INDEX IF NOT EXISTS idx_tenants_status      ON public.tenants (status);
