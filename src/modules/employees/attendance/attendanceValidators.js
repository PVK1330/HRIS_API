'use strict';

const { body, param, query } = require('express-validator');

/** notes: null | undefined | string (including empty) */
const optionalNotes = body('notes')
  .optional({ nullable: true, checkFalsy: false })
  .custom((v) => v === null || v === undefined || typeof v === 'string');

const optionalReason = body('reason')
  .optional({ nullable: true, checkFalsy: false })
  .custom((v) => v === null || v === undefined || typeof v === 'string');

const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

const employeePunchBody = [
  body('employeeId').optional().isInt({ min: 1 }),
  body('workMode').optional().isString().trim(),
  body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
  body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
  body('address').optional({ nullable: true }).isString().trim(),
];

const overrideBody = [
  body('employeeId').isInt({ min: 1 }),
  body('date').isDate(),
  body('workMode').optional().isString().trim(),
  body('status').optional().isString().trim(),
  body('checkInTime').optional({ nullable: true, checkFalsy: false })
    .custom((v) => v === null || v === undefined || timePattern.test(String(v))),
  body('checkOutTime').optional({ nullable: true, checkFalsy: false })
    .custom((v) => v === null || v === undefined || timePattern.test(String(v))),
  body('overtimeHours').optional({ nullable: true }).isFloat({ min: 0 }),
  optionalNotes,
];

module.exports = {
  optionalNotes,
  optionalReason,
  employeePunchBody,
  overrideBody,
  timePattern,
};
