-- 029: Add re-upload button to onboarding_document_rejected email template

UPDATE public.email_templates
SET
  body = '<p>Hi {{candidate_name}},</p><p>Your document <strong>{{document_name}}</strong> requires revision.</p><p><strong>Reason:</strong> {{reason}}</p><p>Please re-upload the corrected document using the button below:</p><p style="margin:20px 0;"><a href="{{reupload_url}}" style="display:inline-block;background-color:#0F766E;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">Re-upload Document</a></p><p style="font-size:12px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:<br/><a href="{{reupload_url}}" style="color:#0F766E;">{{reupload_url}}</a></p><p>Regards,<br/>{{company_name}} HR</p>',
  variables = '["candidate_name","document_name","reason","reupload_url","company_name"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'onboarding_document_rejected';
