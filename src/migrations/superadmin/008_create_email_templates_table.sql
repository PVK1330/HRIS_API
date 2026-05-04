CREATE TABLE IF NOT EXISTS public.email_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        VARCHAR(100) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    body        TEXT         NOT NULL,
    variables   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_slug   ON public.email_templates (slug);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON public.email_templates (is_active);
 
CREATE OR REPLACE FUNCTION update_email_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON public.email_templates;
CREATE TRIGGER trg_email_templates_updated_at
    BEFORE UPDATE ON public.email_templates
    FOR EACH ROW EXECUTE FUNCTION update_email_templates_updated_at();

-- Seed default templates (idempotent)
INSERT INTO public.email_templates (slug, name, subject, body, variables) VALUES
(
    'welcome_admin',
    'Welcome Admin',
    'Welcome to {{app_name}} - Your account is ready',
    '<h2 style="margin:0 0 16px 0;color:#111827;">Welcome, {{admin_name}}!</h2>
<p style="margin:0 0 12px 0;color:#374151;line-height:1.5;">Your admin account has been created successfully.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
  <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Email</td><td style="padding:8px 0;color:#111827;font-weight:600;">{{admin_email}}</td></tr>
  <tr><td style="padding:8px 0;color:#6b7280;">Temporary Password</td><td style="padding:8px 0;color:#111827;font-weight:600;font-family:monospace;">{{admin_password}}</td></tr>
</table>
<p style="margin:16px 0 0 0;color:#374151;line-height:1.5;">Please <a href="{{login_url}}" style="color:#2563eb;text-decoration:none;font-weight:600;">login</a> and change your password immediately.</p>',
    '["admin_name", "admin_email", "admin_password", "app_name", "login_url"]'::jsonb
),
(
    'test_email',
    'Test Email',
    'Test Email from {{app_name}}',
    '<h2 style="margin:0 0 16px 0;color:#111827;">This is a test email</h2>
<p style="margin:0;color:#374151;line-height:1.5;">If you received this, your SMTP email settings are working correctly.</p>',
    '["app_name"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
