CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    employee_id INT NULL REFERENCES employees(id) ON DELETE CASCADE,
    for_admin BOOLEAN DEFAULT false,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_employee_id ON notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_for_admin ON notifications(for_admin);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
