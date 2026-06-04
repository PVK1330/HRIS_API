-- Up
ALTER TABLE tasks
ADD COLUMN related_entity_type VARCHAR(50),
ADD COLUMN related_entity_id BIGINT;

CREATE INDEX idx_tasks_related_entity ON tasks(related_entity_type, related_entity_id);

-- Down
DROP INDEX IF EXISTS idx_tasks_related_entity;
ALTER TABLE tasks
DROP COLUMN IF EXISTS related_entity_type,
DROP COLUMN IF EXISTS related_entity_id;
