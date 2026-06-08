'use strict';

const Joi = require('joi');
const { body } = require('express-validator');
const { isValidWorkEmail } = require('../../utils/validateWorkEmail');

const listingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(10),
  search: Joi.string().allow('').max(300).default(''),
  department: Joi.string().allow('').max(255).default(''),
  status: Joi.string().allow('').max(80).default(''),
  workMode: Joi.string().allow('').max(80).default(''),
  jobTitle: Joi.string().allow('').max(255).default(''),
  workLocation: Joi.string().allow('').max(255).default(''),
  joinDateFrom: Joi.alternatives().try(Joi.string().allow('').max(32), Joi.date()).optional(),
  joinDateTo: Joi.alternatives().try(Joi.string().allow('').max(32), Joi.date()).optional(),
  sortBy: Joi.string()
    .valid('created_at', 'join_date', 'full_name', 'employment_status', 'job_title', 'work_email', 'emp_id')
    .default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('desc'),
  onboardingOnly: Joi.boolean().truthy('true', '1').falsy('false', '0').default(false),
});

const exportQuery = listingQuery.keys({
  type: Joi.string().valid('pdf', 'excel').required(),
});

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

/** Optional server-side filter; returns full list up to cap when empty. */
const dropdownQuery = Joi.object({
  search: Joi.string().allow("").max(300).default(""),
});

// ─── express-validator body rules ────────────────────────────────────────────

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern'];
const EMPLOYMENT_STATUSES = ['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated', 'Onboarding'];

function workEmailRule({ requiredUnlessOnboarding = false } = {}) {
  return body('workEmail')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val, { req }) => {
      const onboarding = req.body.employmentStatus === 'Onboarding';
      if (requiredUnlessOnboarding && !onboarding && !val) {
        throw new Error('workEmail is required');
      }
      if (val && !isValidWorkEmail(val)) {
        throw new Error('Invalid work email');
      }
      return true;
    });
}

/**
 * The ~30 fields that are always optional and have identical constraints on
 * POST (create), PATCH, and PUT.  Defined once; spread into every rule set.
 */
function sharedBodyRules() {
  return [
    body('departmentId').optional({ nullable: true }).isInt({ min: 1 }),
    body('dateOfBirth').optional({ nullable: true }).isDate(),
    body('gender').optional().isIn(['Male', 'Female', 'Other']),
    body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
    body('employmentStatus').optional().isIn(EMPLOYMENT_STATUSES),
    body('probationEndDate').optional({ nullable: true }).isDate(),
    body('passportExpiry').optional({ nullable: true }).isDate(),
    body('emiratesIdExpiry').optional({ nullable: true }).isDate(),
    body('visaExpiryDate').optional({ nullable: true }).isDate(),
    body('dependents').optional({ nullable: true }).isInt({ min: 0 }),
    body('rbacRoleId').optional({ nullable: true }).isInt({ min: 1 }),
    body('portalEnabled').optional().isBoolean(),
    body('portalPassword').optional({ checkFalsy: true }).isString().trim().isLength({ min: 8, max: 200 }),
    body('username').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body('religion').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('employmentSpouse').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('bankName').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
    body('bankAccountNo').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('ifscCode').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('branchAddress').optional({ nullable: true }).isString().trim(),
    body('familyMembers').optional({ nullable: true }).isArray(),
    body('secondaryContact').optional({ nullable: true }).isObject(),
    body('education').optional({ nullable: true }).isArray(),
    body('workExperience').optional({ nullable: true }).isArray(),
    body('isCurrentlyWorking').optional().isBoolean(),
    body('documents').optional({ nullable: true }).isArray(),
    body('bankDetails').optional({ nullable: true }).isObject(),
    body('addresses').optional({ nullable: true }).isArray(),
    body('emergencyContacts').optional({ nullable: true }).isArray(),
    body('educationDetails').optional({ nullable: true }).isArray(),
    body('experienceDetails').optional({ nullable: true }).isArray(),
    body('salaryDetails').optional({ nullable: true }).isObject(),
    body('profileImageBase64').optional({ nullable: true }).isString(),
    body('costCenter').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  ];
}

/**
 * Body validation rules for POST / (employee create).
 * Core profile fields are required; all other fields are optional.
 */
function createRules() {
  return [
    body('empId').optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
    body('fullName').exists({ checkFalsy: true }).withMessage('fullName is required').isString().trim().isLength({ min: 2, max: 255 }),
    body('jobTitle').exists({ checkFalsy: true }).withMessage('jobTitle is required').isString().trim(),
    body('department').exists({ checkFalsy: true }).withMessage('department is required').isString().trim(),
    body('employmentType').exists({ checkFalsy: true }).withMessage('employmentType is required').isIn(EMPLOYMENT_TYPES),
    body('joinDate').exists({ checkFalsy: true }).withMessage('joinDate is required').isDate(),
    body('firstName').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body('lastName').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    workEmailRule({ requiredUnlessOnboarding: true }),
    ...sharedBodyRules(),
  ];
}

/**
 * Body validation rules for PATCH /:id and PUT /:id (employee update).
 * All fields are optional — the service applies only the supplied fields.
 */
function updateRules() {
  return [
    body('fullName').optional().isString().trim().isLength({ min: 2, max: 255 }),
    body('jobTitle').optional().isString().trim(),
    body('department').optional().isString().trim(),
    body('employmentType').optional().isIn(EMPLOYMENT_TYPES),
    body('joinDate').optional().isDate(),
    workEmailRule(),
    ...sharedBodyRules(),
  ];
}

module.exports = {
  listingQuery,
  exportQuery,
  dropdownQuery,
  idParam,
  createRules,
  updateRules,
};
