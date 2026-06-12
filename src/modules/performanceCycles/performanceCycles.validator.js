'use strict';

/**
 * ============================================================================
 * Performance Cycles Validator
 * ============================================================================
 * Input validation schemas using Joi for:
 * - Request body validation
 * - Query parameter validation
 * - Parameter validation
 * ============================================================================
 */

const Joi = require('joi');

/**
 * Validation schema for creating a new performance cycle
 */
const createCycleSchema = Joi.object({
  cycleName: Joi.string()
    .trim()
    .required()
    .min(3)
    .max(255)
    .messages({
      'string.empty': 'Cycle name is required',
      'string.min': 'Cycle name must be at least 3 characters',
      'string.max': 'Cycle name must not exceed 255 characters',
    }),

  startDate: Joi.date()
    .iso()
    .required()
    .messages({
      'date.base': 'Start date must be a valid ISO date',
      'date.required': 'Start date is required',
    }),

  endDate: Joi.date()
    .iso()
    .required()
    .greater(Joi.ref('startDate'))
    .messages({
      'date.base': 'End date must be a valid ISO date',
      'date.greater': 'End date must be after start date',
    }),

  submissionDeadline: Joi.date()
    .iso()
    .required()
    .messages({
      'date.base': 'Submission deadline must be a valid ISO date',
      'date.required': 'Submission deadline is required',
    }),

  automatedReminder: Joi.boolean()
    .optional()
    .default(false)
    .messages({
      'boolean.base': 'Automated reminder must be a boolean',
    }),
});

/**
 * Validation schema for updating a performance cycle
 * All fields are optional, but startDate and endDate must be supplied together
 * so that the end > start invariant can always be enforced at validation time.
 */
const updateCycleSchema = Joi.object({
  cycleName: Joi.string()
    .trim()
    .optional()
    .min(3)
    .max(255)
    .messages({
      'string.min': 'Cycle name must be at least 3 characters',
      'string.max': 'Cycle name must not exceed 255 characters',
    }),

  startDate: Joi.date()
    .iso()
    .optional()
    .messages({
      'date.base': 'Start date must be a valid ISO date',
    }),

  endDate: Joi.date()
    .iso()
    .optional()
    .when('startDate', {
      is: Joi.date().required(),
      then: Joi.date().greater(Joi.ref('startDate')),
      otherwise: Joi.date().iso().optional(),
    })
    .messages({
      'date.base': 'End date must be a valid ISO date',
      'date.greater': 'End date must be after start date',
    }),

  submissionDeadline: Joi.date()
    .iso()
    .optional()
    .messages({
      'date.base': 'Submission deadline must be a valid ISO date',
    }),

  automatedReminder: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'Automated reminder must be a boolean',
    }),
})
  // Require both dates to be present when either is supplied so the
  // end > start cross-field check is never skipped on a one-sided PATCH.
  .and('startDate', 'endDate')
  .messages({
    'object.and':
      'Both startDate and endDate must be provided together when updating cycle dates',
  });

/**
 * Validation schema for query parameters
 */
const querySchema = Joi.object({
  search: Joi.string()
    .trim()
    .optional()
    .max(255)
    .messages({
      'string.max': 'Search term must not exceed 255 characters',
    }),

  status: Joi.string()
    .optional()
    .valid('ACTIVE', 'UPCOMING', 'COMPLETED')
    .messages({
      'any.only': 'Status must be one of: ACTIVE, UPCOMING, COMPLETED',
    }),

  page: Joi.number()
    .integer()
    .optional()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'Page must be a number',
      'number.min': 'Page must be at least 1',
    }),

  limit: Joi.number()
    .integer()
    .optional()
    .min(1)
    .max(100)
    .default(10)
    .messages({
      'number.base': 'Limit must be a number',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 100',
    }),
});

/**
 * Validation schema for route parameters
 */
const paramsSchema = Joi.object({
  id: Joi.number()
    .integer()
    .required()
    .min(1)
    .messages({
      'number.base': 'ID must be a number',
      'number.min': 'ID must be a positive number',
    }),
});

module.exports = {
  createCycleSchema,
  updateCycleSchema,
  querySchema,
  paramsSchema,
};
