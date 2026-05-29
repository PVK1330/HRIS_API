-- Seed letter tags
INSERT INTO letter_tags (tag, description, is_system) VALUES
('employee_name', 'Full name of the employee', TRUE),
('employee_id', 'Employee ID', TRUE),
('job_title', 'Designation / Job Title', TRUE),
('department', 'Department Name', TRUE),
('joining_date', 'Date of Joining', TRUE),
('salary', 'Current Salary', TRUE),
('work_email', 'Official Work Email', TRUE),
('work_location', 'Work Location', TRUE),
('today_date', 'Current Date', TRUE),
('company_name', 'Name of the Organization', TRUE)
ON CONFLICT DO NOTHING;

-- Seed default templates
INSERT INTO letter_templates (name, type, category, description, body, status) VALUES
('Standard Offer Letter', 'Letter', 'Recruitment', 'Standard employment offer letter for new hires', '<h2>Offer of Employment</h2><p>Dear {{employee_name}},</p><p>We are pleased to offer you the position of <strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department at {{company_name}}.</p><p>Your scheduled joining date is {{joining_date}}.</p><p>Your starting compensation will be {{salary}} per annum.</p><p>Welcome aboard!</p>', 'Active'),
('Relieving Letter', 'Letter', 'Exit', 'Standard relieving letter for exiting employees', '<h2>Relieving Letter</h2><p>Dear {{employee_name}},</p><p>This is in reference to your resignation from the position of <strong>{{job_title}}</strong>.</p><p>We wish to inform you that your resignation has been accepted, and you will be relieved from your duties at {{company_name}} effective today, {{today_date}}.</p><p>We wish you all the best in your future endeavors.</p>', 'Active'),
('Warning Letter', 'Letter', 'Disciplinary', 'Standard warning letter for disciplinary action', '<h2>Warning Letter</h2><p>Dear {{employee_name}},</p><p>This letter serves as a formal warning regarding your recent conduct in the <strong>{{department}}</strong> department.</p><p>Further violations may result in severe disciplinary actions. We expect immediate improvement.</p>', 'Active'),
('Experience Certificate', 'Certificate', 'Exit', 'Experience certificate for past employees', '<h2>Experience Certificate</h2><p>To Whom It May Concern,</p><p>This is to certify that <strong>{{employee_name}}</strong> (Emp ID: {{employee_id}}) was employed with {{company_name}} as a <strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department.</p><p>During their tenure, we found their performance to be satisfactory.</p>', 'Active')
ON CONFLICT DO NOTHING;
