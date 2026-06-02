-- 023_seed_exit_email_templates.sql
-- Transactional email templates for Exit Management events. Stored in the global
-- public.email_templates catalog (editable under Settings → Email). Sent via
-- Mailer.send({ templateSlug, variables }). Bodies use {{variable}} syntax and are
-- wrapped in the standard email base layout at send time.

INSERT INTO public.email_templates (slug, name, subject, body, variables, is_active) VALUES
(
  'exit_request_submitted',
  'Exit — Request Submitted',
  'Your exit request has been submitted',
  '<p>Hi {{employee_name}},</p><p>Your {{exit_type}} request has been submitted and is now moving through {{company_name}}''s exit workflow. We will keep you updated as each stage is completed.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["employee_name","exit_type","company_name"]'::jsonb,
  true
),
(
  'exit_stage_pending',
  'Exit — Action Required',
  'Action required: {{stage_name}} — exit of {{employee_name}}',
  '<p>Hi {{recipient_name}},</p><p>An exit request for <strong>{{employee_name}}</strong> ({{job_title}}) has reached the <strong>{{stage_name}}</strong> stage and needs your action. Please review and action it in the HR portal.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","employee_name","job_title","stage_name","company_name"]'::jsonb,
  true
),
(
  'exit_request_rejected',
  'Exit — Request Rejected',
  'Update on your exit request',
  '<p>Hi {{employee_name}},</p><p>Your exit request has been rejected. Reason: {{reason}}.</p><p>Please contact the HR department if you have any questions.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["employee_name","reason","company_name"]'::jsonb,
  true
),
(
  'exit_request_completed',
  'Exit — Process Completed',
  'Your exit process is complete',
  '<p>Hi {{employee_name}},</p><p>Your exit process at {{company_name}} is now complete. Your exit documents (if any) will be shared separately. We wish you all the best for the future.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["employee_name","company_name"]'::jsonb,
  true
)
ON CONFLICT (slug) DO NOTHING;
