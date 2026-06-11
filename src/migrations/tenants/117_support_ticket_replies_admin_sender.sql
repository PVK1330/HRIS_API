-- 117: allow tenant ADMIN replies on support tickets (two-way conversation).
--
-- support_ticket_replies previously only stored superadmin responses
-- (superadmin_id NOT NULL), so a tenant admin's follow-up message had nowhere to
-- go — the admin "Send Response" composer 400'd with "No updates were provided".
-- Make the author column nullable and record the sender's role + id so the
-- conversation can distinguish admin vs superadmin messages. Existing rows keep
-- the 'superadmin' default (all prior replies were superadmin responses).
ALTER TABLE support_ticket_replies ALTER COLUMN superadmin_id DROP NOT NULL;
ALTER TABLE support_ticket_replies ADD COLUMN IF NOT EXISTS sender_role VARCHAR(20) NOT NULL DEFAULT 'superadmin';
ALTER TABLE support_ticket_replies ADD COLUMN IF NOT EXISTS sender_id INTEGER;
