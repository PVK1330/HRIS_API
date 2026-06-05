'use strict';

/** Shared option lists for routes (express-validator) and service validation */
module.exports = {
  EARLY_DEPARTURE_RULES: ['Mark half day', 'Mark absent', 'No penalty', 'Custom'],
  WHO_CAN_SUBMIT: ['All employees', 'Manager only', 'HR only'],
  APPROVERS: ['HR', 'Manager', 'Direct Manager', 'HR Manager'],
  OVERTIME_CALC_RULES: ['1.5x hourly', '2x hourly', 'Flat rate', 'Custom'],
  OVERTIME_APPROVAL: ['Manager → HR', 'HR only', 'Manager only', 'Auto-approve'],
  OVERTIME_APPROVERS: ['HR Department', 'Direct Manager', 'HOD', 'Manager + HR'],
};
