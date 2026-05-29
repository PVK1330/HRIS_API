'use strict';

const Joi = require('joi');

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const taskIdParam = Joi.object({
  id: Joi.number().integer().positive().required(),
  taskId: Joi.number().integer().positive().required(),
});

const assetIdParam = Joi.object({
  id: Joi.number().integer().positive().required(),
  assetId: Joi.number().integer().positive().required(),
});

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow('').max(200).default(''),
  status: Joi.string()
    .valid(
      'all', 'Pending Approval', 'Approved', 'Rejected',
      'In Progress', 'Completed', 'clearance', 'interview', 'settlement',
    )
    .default('all'),
  exit_type: Joi.string().valid('all', 'Resignation', 'Termination').default('all'),
  employee_id: Joi.number().integer().positive().optional(),
  sortBy: Joi.string()
    .valid('created_at', 'updated_at', 'last_working_day', 'employee_name')
    .default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('desc'),
});

const createResignationBody = Joi.object({
  employee_id: Joi.number().integer().positive().required(),
  notice_date: Joi.date().iso().allow('', null).optional(),
  resignation_date: Joi.date().iso().allow('', null).optional(),
  last_working_day: Joi.date().iso().required(),
  notice_period_days: Joi.number().integer().min(0).allow('', null).optional(),
  exit_reason: Joi.string().trim().max(2000).allow('', null).optional(),
  reason_detail: Joi.string().trim().max(2000).allow('', null).optional(),
  exit_interview_date: Joi.date().iso().allow(null).optional(),
  exit_interview_by: Joi.number().integer().positive().allow(null).optional(),
  exit_interview_notes: Joi.string().trim().max(2000).allow('', null).optional(),
  remarks: Joi.string().trim().max(2000).allow('', null).optional(),
});

const createTerminationBody = Joi.object({
  employee_id: Joi.number().integer().positive().required(),
  termination_type_id: Joi.number().integer().positive().required(),
  last_working_day: Joi.date().iso().required(),
  notice_date: Joi.date().iso().allow('', null).optional(),
  resignation_date: Joi.date().iso().allow('', null).optional(),
  notice_period_days: Joi.number().integer().min(0).allow('', null).optional(),
  exit_reason: Joi.string().trim().max(2000).allow('', null).optional(),
  reason_detail: Joi.string().trim().max(2000).allow('', null).optional(),
  is_voluntary: Joi.boolean().optional(),
  exit_interview_date: Joi.date().iso().allow(null).optional(),
  exit_interview_by: Joi.number().integer().positive().allow(null).optional(),
  exit_interview_notes: Joi.string().trim().max(2000).allow('', null).optional(),
  remarks: Joi.string().trim().max(2000).allow('', null).optional(),
});

const updateExitBody = Joi.object({
  last_working_day: Joi.date().iso().optional(),
  notice_period_days: Joi.number().integer().min(0).optional(),
  exit_reason: Joi.string().trim().max(2000).allow('', null).optional(),
  exit_interview_date: Joi.date().iso().allow(null).optional(),
  exit_interview_by: Joi.number().integer().positive().allow(null).optional(),
  exit_interview_notes: Joi.string().trim().max(2000).allow('', null).optional(),
  remarks: Joi.string().trim().max(2000).allow('', null).optional(),
  termination_type_id: Joi.number().integer().positive().allow(null).optional(),
  notice_date: Joi.date().iso().allow(null).optional(),
  resignation_date: Joi.date().iso().allow(null).optional(),
});

const rejectBody = Joi.object({
  rejection_reason: Joi.string().trim().min(1).max(2000).required(),
});

const updateStatusBody = Joi.object({
  status: Joi.string()
    .valid('Approved', 'In Progress', 'clearance', 'interview', 'settlement', 'Completed')
    .required(),
});

const createClearanceTaskBody = Joi.object({
  department: Joi.string().trim().min(1).max(100).required(),
  task_name: Joi.string().trim().min(1).max(255).required(),
  assigned_to: Joi.number().integer().positive().allow(null).optional(),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
  sort_order: Joi.number().integer().min(0).optional().default(0),
  due_date: Joi.date().iso().allow(null).optional(),
  sla_hours: Joi.number().integer().min(0).optional().default(0),
});

const updateClearanceTaskBody = Joi.object({
  task_name: Joi.string().trim().min(1).max(255).optional(),
  department: Joi.string().trim().min(1).max(100).optional(),
  assigned_to: Joi.number().integer().positive().allow(null).optional(),
  is_completed: Joi.boolean().optional(),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
  sort_order: Joi.number().integer().min(0).optional(),
  due_date: Joi.date().iso().allow(null).optional(),
  sla_hours: Joi.number().integer().min(0).optional(),
  document_url: Joi.string().trim().max(500).allow(null, '').optional(),
  document_name: Joi.string().trim().max(255).allow(null, '').optional(),
  uploaded_at: Joi.date().iso().allow(null).optional(),
});

const createAssetReturnBody = Joi.object({
  asset_name: Joi.string().trim().min(1).max(255).required(),
  asset_code: Joi.string().trim().max(50).allow('', null).optional(),
  asset_type: Joi.string().trim().max(100).allow('', null).optional(),
  condition_on_return: Joi.string().trim().max(100).allow('', null).optional(),
  return_date: Joi.date().iso().allow(null).optional(),
  returned_by: Joi.number().integer().positive().allow(null).optional(),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
  status: Joi.string().valid('Pending', 'Returned', 'Lost', 'Damaged').default('Pending'),
});

const updateAssetReturnBody = Joi.object({
  asset_name: Joi.string().trim().min(1).max(255).optional(),
  asset_code: Joi.string().trim().max(50).allow('', null).optional(),
  asset_type: Joi.string().trim().max(100).allow('', null).optional(),
  condition_on_return: Joi.string().trim().max(100).allow('', null).optional(),
  return_date: Joi.date().iso().allow(null).optional(),
  returned_by: Joi.number().integer().positive().allow(null).optional(),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
  status: Joi.string().valid('Pending', 'Returned', 'Lost', 'Damaged').optional(),
});

const generateDocumentBody = Joi.object({
  document_type: Joi.string()
    .valid('Experience Letter', 'No Objection Certificate', 'NOC', 'Relieving Letter', 'Termination Letter', 'Full & Final Statement', 'Full & Final Settlement', 'Final Payslip')
    .required(),
  document_title: Joi.string().trim().min(1).max(255).optional(),
});

const submitInterviewBody = Joi.object({
  exit_request_id: Joi.number().integer().positive().required(),
  format: Joi.string().valid('in_person', 'virtual', 'written').required(),
  feedback: Joi.string().trim().min(20).max(5000).required(),
  rehire_eligible: Joi.string().valid('yes', 'no', 'maybe').default('maybe'),
  overall_rating: Joi.number().integer().min(1).max(5).required(),
});

const processSettlementBody = Joi.object({
  exit_request_id: Joi.number().integer().positive().required(),
  unpaid_salary: Joi.number().min(0).default(0),
  leave_encashment: Joi.number().min(0).default(0),
  gratuity: Joi.number().min(0).default(0),
  deductions: Joi.number().min(0).default(0),
  net_payable: Joi.number().min(0).default(0),
  notes: Joi.string().trim().max(2000).allow('', null).optional(),
});

const submitWithdrawalBody = Joi.object({
  withdrawal_reason: Joi.string().trim().min(10).max(2000).required(),
});

const rejectWithdrawalBody = Joi.object({
  rejection_reason: Joi.string().trim().min(5).max(2000).required(),
});

const stepIdParam = Joi.object({
  id: Joi.number().integer().positive().required(),
  stepId: Joi.number().integer().positive().required(),
});

const assignWorkflowBody = Joi.object({
  steps: Joi.array()
    .items(
      Joi.object({
        department_id: Joi.number().integer().positive().required(),
        department_head_id: Joi.number().integer().positive().allow(null).optional(),
        step_order: Joi.number().integer().min(1).optional(),
        is_mandatory: Joi.boolean().default(true),
        remarks: Joi.string().trim().max(2000).allow('', null).optional(),
      }),
    )
    .min(1)
    .required(),
});

const reorderWorkflowBody = Joi.object({
  ordered_step_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

const approveStepBody = Joi.object({
  comments: Joi.string().trim().max(2000).allow('', null).optional(),
});

const rejectStepBody = Joi.object({
  rejection_reason: Joi.string().trim().min(3).max(2000).required(),
});

const reassignHeadBody = Joi.object({
  department_head_id: Joi.number().integer().positive().required(),
});

module.exports = {
  idParam,
  taskIdParam,
  assetIdParam,
  stepIdParam,
  listingQuery,
  createResignationBody,
  createTerminationBody,
  updateExitBody,
  rejectBody,
  updateStatusBody,
  createClearanceTaskBody,
  updateClearanceTaskBody,
  createAssetReturnBody,
  updateAssetReturnBody,
  generateDocumentBody,
  submitInterviewBody,
  processSettlementBody,
  submitWithdrawalBody,
  rejectWithdrawalBody,
  assignWorkflowBody,
  reorderWorkflowBody,
  approveStepBody,
  rejectStepBody,
  reassignHeadBody,
};
