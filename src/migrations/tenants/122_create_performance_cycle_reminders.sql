-- 122_create_performance_cycle_reminders.sql
CREATE TABLE IF NOT EXISTS performance_cycle_reminders (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    recipient_type VARCHAR(50) NOT NULL,
    recipient_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perf_cycle_reminders_lookup 
ON performance_cycle_reminders(cycle_id, recipient_id, recipient_type);
