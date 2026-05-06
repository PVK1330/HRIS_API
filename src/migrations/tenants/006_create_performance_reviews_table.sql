-- 006_create_performance_reviews_table.sql
-- Performance management and reviews

CREATE TABLE IF NOT EXISTS performance_reviews (
    id                  SERIAL PRIMARY KEY,
    employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    review_period       VARCHAR(50) NOT NULL, -- H1 2026, Q4 2025, etc.
    review_type         VARCHAR(50) NOT NULL, -- Annual, Quarterly, Probation, Promotion
    reviewer_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE SET NULL,
    review_date         DATE NOT NULL,
    
    -- Ratings (1-5 scale)
    work_quality        INTEGER CHECK (work_quality BETWEEN 1 AND 5),
    productivity         INTEGER CHECK (productivity BETWEEN 1 AND 5),
    communication       INTEGER CHECK (communication BETWEEN 1 AND 5),
    teamwork            INTEGER CHECK (teamwork BETWEEN 1 AND 5),
    leadership          INTEGER CHECK (leadership BETWEEN 1 AND 5),
    overall_rating      VARCHAR(20), -- Exceeds, Meets, Developing, Below
    
    -- Comments
    strengths           TEXT,
    areas_to_improve    TEXT,
    goals_next_period   TEXT,
    reviewer_comments   TEXT,
    employee_comments   TEXT,
    
    status              VARCHAR(50) NOT NULL DEFAULT 'Draft', -- Draft, Submitted, Reviewed, Completed
    due_date            DATE,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee_id ON performance_reviews (employee_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_reviewer_id ON performance_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_period ON performance_reviews (review_period);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_status ON performance_reviews (status);

CREATE TRIGGER update_performance_reviews_updated_at BEFORE UPDATE ON performance_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
