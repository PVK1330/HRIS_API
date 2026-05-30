-- Message attachments (images, documents, etc.)

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(128),
  ADD COLUMN IF NOT EXISTS attachment_size INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
