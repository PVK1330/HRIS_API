-- 035_create_conversations_table.sql
-- Direct message conversations between employees

CREATE TABLE IF NOT EXISTS conversations (
    id          SERIAL PRIMARY KEY,
    -- sorted participant IDs to ensure uniqueness
    participant_a  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    participant_b  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    last_message   TEXT,
    last_message_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(participant_a, participant_b),
    CHECK(participant_a < participant_b)   -- enforce sorted order
);

CREATE INDEX IF NOT EXISTS idx_conversations_a ON conversations(participant_a);
CREATE INDEX IF NOT EXISTS idx_conversations_b ON conversations(participant_b);
CREATE INDEX IF NOT EXISTS idx_conversations_last ON conversations(last_message_at DESC);
