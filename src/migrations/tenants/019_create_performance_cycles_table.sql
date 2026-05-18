-- ============================================================================
-- Migration: Create Performance Cycles Table
-- Date: 2026-05-18
-- Description: Creates the performance_cycles table for managing performance
--              review cycles with status tracking and automated reminders
-- ============================================================================

CREATE TABLE IF NOT EXISTS performance_cycles (
  id SERIAL PRIMARY KEY,
  
  -- Cycle Information
  cycle_name VARCHAR(255) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  submission_deadline TIMESTAMPTZ NOT NULL,
  
  -- Configuration
  automated_reminder BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Status enum: ACTIVE, UPCOMING, COMPLETED
  -- Status is computed based on current date vs start_date and end_date
  status VARCHAR(50) NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('ACTIVE', 'UPCOMING', 'COMPLETED')),
  
  -- Completion percentage (0-100)
  completion_percentage INTEGER NOT NULL DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
  
  -- Audit Fields
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Index on status for faster queries
CREATE INDEX idx_performance_cycles_status ON performance_cycles(status) WHERE deleted_at IS NULL;

-- Index on dates for range queries
CREATE INDEX idx_performance_cycles_dates ON performance_cycles(start_date, end_date) WHERE deleted_at IS NULL;

-- Index on cycle_name for search functionality
CREATE INDEX idx_performance_cycles_name ON performance_cycles(LOWER(cycle_name)) WHERE deleted_at IS NULL;

-- Index for filtering active/upcoming cycles
CREATE INDEX idx_performance_cycles_active ON performance_cycles(start_date, end_date, status) WHERE deleted_at IS NULL;

-- Automatic updated_at timestamp function
CREATE OR REPLACE FUNCTION update_performance_cycles_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on modification
DROP TRIGGER IF EXISTS trigger_update_performance_cycles_timestamp ON performance_cycles;
CREATE TRIGGER trigger_update_performance_cycles_timestamp
  BEFORE UPDATE ON performance_cycles
  FOR EACH ROW
  EXECUTE FUNCTION update_performance_cycles_timestamp();
