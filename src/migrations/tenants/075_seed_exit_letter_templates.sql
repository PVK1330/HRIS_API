-- Exit letter dynamic tags + default Exit category templates

INSERT INTO letter_tags (tag, description, is_system) VALUES
('last_working_day', 'Employee last working day', TRUE),
('exit_reason', 'Reason for exit / termination', TRUE),
('exit_type', 'Resignation or Termination', TRUE),
('notice_period', 'Notice period in days', TRUE),
('document_type', 'Generated document type', TRUE),
('manager_name', 'Reporting manager name', TRUE),
('resignation_date', 'Resignation submission date', TRUE),
('net_payable', 'Full & Final net payable amount', TRUE),
('unpaid_salary', 'Unpaid salary in settlement', TRUE),
('leave_encashment', 'Leave encashment amount', TRUE),
('gratuity', 'Gratuity amount', TRUE),
('deductions', 'Settlement deductions', TRUE)
ON CONFLICT (tag) DO NOTHING;

INSERT INTO letter_templates (name, type, category, description, body, status)
SELECT v.name, v.type, v.category, v.description, v.body, 'Active'
FROM (VALUES
  (
    'No Objection Certificate',
    'Certificate',
    'Exit',
    'NOC confirming employee cleared all obligations',
    '<h2 style="text-align:center;color:#0F766E;">No Objection Certificate</h2><p>Date: {{today_date}}</p><p>To Whom It May Concern,</p><p>This is to certify that <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}}), {{job_title}} in the {{department}} department at {{company_name}}, has completed all exit formalities as of {{last_working_day}}.</p><p>We have no objection to {{employee_name}} joining any other organisation.</p><p>Yours sincerely,<br><strong>Human Resources Department</strong></p>'
  ),
  (
    'Full & Final Settlement',
    'Letter',
    'Exit',
    'Full and final settlement statement for exiting employees',
    '<h2 style="text-align:center;color:#0F766E;">Full &amp; Final Settlement</h2><p>Date: {{today_date}}</p><p>Dear <strong>{{employee_name}}</strong>,</p><p>Settlement for separation from {{company_name}} (last working day: {{last_working_day}}).</p><p>Unpaid Salary: {{unpaid_salary}} | Leave Encashment: {{leave_encashment}} | Gratuity: {{gratuity}} | Deductions: {{deductions}} | Net Payable: {{net_payable}}</p><p>Yours sincerely,<br><strong>Finance &amp; HR Department</strong></p>'
  ),
  (
    'Recommendation Letter',
    'Letter',
    'Exit',
    'Professional recommendation for exiting employee',
    '<h2 style="text-align:center;color:#0F766E;">Recommendation Letter</h2><p>Date: {{today_date}}</p><p><strong>To Whom It May Concern</strong></p><p>I recommend <strong>{{employee_name}}</strong>, {{job_title}} in {{department}} at {{company_name}}, from {{joining_date}} to {{last_working_day}}.</p><p>Yours sincerely,<br><strong>Human Resources Department</strong></p>'
  ),
  (
    'Final Payslip',
    'Report',
    'Exit',
    'Final payslip issued at exit',
    '<h2 style="text-align:center;color:#0F766E;">Final Payslip</h2><p>Date: {{today_date}}</p><p>Employee: <strong>{{employee_name}}</strong> ({{employee_id}}) | {{job_title}} | {{department}}</p><p>Joining: {{joining_date}} | Last Working Day: {{last_working_day}} | Net Payable: {{net_payable}}</p><p>Yours sincerely,<br><strong>Payroll Department</strong></p>'
  )
) AS v(name, type, category, description, body)
WHERE NOT EXISTS (
  SELECT 1 FROM letter_templates lt WHERE lt.name = v.name
);

UPDATE letter_templates
SET body = '<h2 style="text-align:center;color:#0F766E;">Relieving Letter</h2><p>Date: {{today_date}}</p><p>Dear <strong>{{employee_name}}</strong>,</p><p>Employed as <strong>{{job_title}}</strong> in <strong>{{department}}</strong> at {{company_name}} from {{joining_date}}. Last working day: <strong>{{last_working_day}}</strong>.</p><p>Yours sincerely,<br><strong>Human Resources Department</strong></p>'
WHERE name = 'Relieving Letter' AND category = 'Exit'
  AND (body IS NULL OR length(body) < 120);

UPDATE letter_templates
SET body = '<h2 style="text-align:center;color:#0F766E;">Experience Certificate</h2><p>Date: {{today_date}}</p><p><strong>To Whom It May Concern</strong></p><p><strong>{{employee_name}}</strong> ({{employee_id}}) — {{job_title}}, {{department}}, {{joining_date}} to {{last_working_day}} at {{company_name}}.</p><p>Yours sincerely,<br><strong>Human Resources Department</strong></p>'
WHERE name = 'Experience Certificate' AND category = 'Exit'
  AND (body IS NULL OR length(body) < 120);
