-- ============================================================================
-- Migration: Create Competencies Table
-- Date: 2026-05-18
-- Description: Creates the competencies table for managing employee competencies
-- ============================================================================

CREATE TABLE IF NOT EXISTS competencies (
  id SERIAL PRIMARY KEY,
  competency_name VARCHAR(255) NOT NULL UNIQUE,
  
  -- Audit Fields
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Index on competency_name for fast lookup and regex queries
CREATE INDEX idx_competencies_name ON competencies(LOWER(competency_name)) WHERE deleted_at IS NULL;

-- Trigger to automatically update updated_at on modification
DROP TRIGGER IF EXISTS trigger_update_competencies_timestamp ON competencies;
CREATE TRIGGER trigger_update_competencies_timestamp
  BEFORE UPDATE ON competencies
  FOR EACH ROW
  EXECUTE FUNCTION update_performance_cycles_timestamp();
