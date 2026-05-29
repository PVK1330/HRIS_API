CREATE TABLE IF NOT EXISTS letter_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'Letter',
    category VARCHAR(50) NOT NULL,
    description TEXT,
    body TEXT,
    status VARCHAR(20) DEFAULT 'Active',
    usage_count INTEGER DEFAULT 0,
    created_by INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS letter_dispatch_history (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES letter_templates(id) ON DELETE SET NULL,
    employee_id INTEGER,
    employee VARCHAR(255),
    template VARCHAR(255),
    sent_by VARCHAR(255),
    body_snapshot TEXT,
    status VARCHAR(50) DEFAULT 'Delivered',
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS letter_tags (
    id SERIAL PRIMARY KEY,
    tag VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    is_system BOOLEAN DEFAULT FALSE,
    created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
