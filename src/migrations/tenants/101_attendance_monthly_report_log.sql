-- 101_attendance_monthly_report_log.sql
-- Tracks which department late-arrival / early-exit monthly reports have already been
-- emailed, so the cron never double-sends if it runs more than once for a period.

CREATE TABLE IF NOT EXISTS attendance_monthly_report_log (
    id              SERIAL PRIMARY KEY,
    report_year     INTEGER NOT NULL,
    report_month    INTEGER NOT NULL,
    department      VARCHAR(255) NOT NULL,
    recipients      TEXT,
    late_count      INTEGER NOT NULL DEFAULT 0,
    early_count     INTEGER NOT NULL DEFAULT 0,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (report_year, report_month, department)
);
