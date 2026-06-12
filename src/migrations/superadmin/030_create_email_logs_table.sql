CREATE TABLE IF NOT EXISTS public.email_logs (
    id          BIGSERIAL    PRIMARY KEY,
    sent_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    recipient   TEXT         NOT NULL,
    subject     TEXT         NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed'
    error       TEXT,
    message_id  TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON public.email_logs (sent_at DESC);

-- Auto-purge rows older than 90 days (best-effort; runs at INSERT time).
-- A cron job or pg_cron can call this periodically for a cleaner purge strategy.
CREATE OR REPLACE FUNCTION public.purge_old_email_logs() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.email_logs WHERE sent_at < NOW() - INTERVAL '90 days';
END;
$$;
