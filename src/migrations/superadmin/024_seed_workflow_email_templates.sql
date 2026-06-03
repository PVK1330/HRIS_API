-- 024: Email templates for onboarding and extended exit workflow events

INSERT INTO public.email_templates (slug, name, subject, body, variables, is_active) VALUES
(
  'onboarding_offer_sent_hr',
  'Onboarding — Offer Sent (HR)',
  'Offer letter sent to {{candidate_name}}',
  '<p>Hi {{recipient_name}},</p><p>An offer letter has been sent to <strong>{{candidate_name}}</strong> for the role of {{job_title}}.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","candidate_name","job_title","company_name"]'::jsonb,
  true
),
(
  'onboarding_hr_rejected',
  'Onboarding — Application Rejected',
  'Update on your onboarding application',
  '<p>Hi {{candidate_name}},</p><p>Your onboarding application has been rejected.</p><p>{{reason}}</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["candidate_name","reason","company_name"]'::jsonb,
  true
),
(
  'onboarding_document_approved',
  'Onboarding — Document Approved',
  'Document approved: {{document_name}}',
  '<p>Hi {{candidate_name}},</p><p>Your document <strong>{{document_name}}</strong> has been approved.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["candidate_name","document_name","company_name"]'::jsonb,
  true
),
(
  'onboarding_document_rejected',
  'Onboarding — Document Rejected',
  'Document requires revision: {{document_name}}',
  '<p>Hi {{candidate_name}},</p><p>Your document <strong>{{document_name}}</strong> was rejected.</p><p>Reason: {{reason}}</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["candidate_name","document_name","reason","company_name"]'::jsonb,
  true
),
(
  'onboarding_document_review_hr',
  'Onboarding — Document Reviewed (HR)',
  'Document {{review_status}} for {{candidate_name}}',
  '<p>Hi {{recipient_name}},</p><p>The document <strong>{{document_name}}</strong> for {{candidate_name}} was marked <strong>{{review_status}}</strong>.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","candidate_name","document_name","review_status","company_name"]'::jsonb,
  true
),
(
  'exit_request_withdrawn',
  'Exit — Request Withdrawn',
  'Exit request withdrawn for {{employee_name}}',
  '<p>Hi {{recipient_name}},</p><p>The exit request for <strong>{{employee_name}}</strong> has been withdrawn.</p><p>{{reason}}</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","employee_name","reason","company_name"]'::jsonb,
  true
),
(
  'exit_request_sent_back',
  'Exit — Sent Back for Revision',
  'Your exit request has been sent back for revision',
  '<p>Hi {{recipient_name}},</p><p>The exit request for <strong>{{employee_name}}</strong> was sent back at stage <strong>{{stage_name}}</strong>.</p><p><strong>Reason:</strong> {{reason}}</p><p><strong>From:</strong> {{sender_name}}</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","employee_name","stage_name","reason","sender_name","company_name"]'::jsonb,
  true
),
(
  'exit_comment_added',
  'Exit — New Comment',
  'New comment on exit request for {{employee_name}}',
  '<p>Hi {{recipient_name}},</p><p><strong>{{sender_name}}</strong> added a comment on the exit request for {{employee_name}}:</p><blockquote>{{comment}}</blockquote><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","employee_name","sender_name","comment","company_name"]'::jsonb,
  true
),
(
  'exit_task_completed',
  'Exit — Task Completed',
  'Exit task completed: {{task_title}}',
  '<p>Hi {{recipient_name}},</p><p>The exit task <strong>{{task_title}}</strong> for {{employee_name}} has been completed.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","employee_name","task_title","company_name"]'::jsonb,
  true
),
(
  'exit_sla_breach',
  'Exit — SLA Breach',
  'Exit Workflow SLA Breach — {{stage_name}}',
  '<p>Hi {{recipient_name}},</p><p>The exit stage <strong>{{stage_name}}</strong> for <strong>{{employee_name}}</strong> has breached its SLA.</p><p><strong>Due:</strong> {{due_date}}<br/><strong>Delay (hours):</strong> {{delay_hours}}</p><p>Please take action in the HR portal.</p><p>Regards,<br/>{{company_name}} HR</p>',
  '["recipient_name","employee_name","stage_name","due_date","delay_hours","company_name"]'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  variables = EXCLUDED.variables,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
