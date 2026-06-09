-- 115_policies_review_reminded_at.sql
-- P4: review-date reminders. Tracks the last time a "policy is due for review"
-- reminder was sent for each policy, so the cron doesn't re-notify every day.
-- Reset to NULL when the review_date changes (a new review cycle). Additive + idempotent.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS review_reminded_at TIMESTAMP;
