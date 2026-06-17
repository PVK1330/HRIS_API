'use strict';

/** Shared option lists for routes (express-validator) and service validation */
module.exports = {
  EARLY_DEPARTURE_RULES: ['Mark half day', 'Mark absent', 'No penalty', 'Custom'],
  WHO_CAN_SUBMIT: ['All employees', 'Manager only', 'HR only'],
  APPROVERS: ['HR', 'Manager', 'Direct Manager', 'HR Manager'],
  OVERTIME_CALC_RULES: ['1.5x hourly', '2x hourly', 'Flat rate', 'Custom'],
  OVERTIME_APPROVAL: [
    // Legacy short strings (kept for backward compatibility)
    'Manager → HR', 'HR only', 'Manager only', 'Auto-approve',
    // Full-label strings sent by the updated frontend
    'Reporting Manager → HR',
    'Reporting Manager → Dept Head → HR',
    'HR Only',
    'Auto Approve',
  ],
  OVERTIME_APPROVERS: ['HR Department', 'Direct Manager', 'HOD', 'Manager + HR'],
};
