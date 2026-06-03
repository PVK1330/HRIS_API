'use strict';

const ATTENDANCE_STATUSES = Object.freeze([
  'Present',
  'Late',
  'Half Day',
  'Absent',
  'Weekend',
  'Holiday',
  'On Leave',
  'Work From Home',
  'Remote',
  'Field Duty',
  'Regularization Pending',
  'Regularization Approved',
  'Regularization Rejected',
]);

const REGULARIZATION_STATUSES = Object.freeze([
  'N/A',
  'Pending',
  'Approved',
  'Rejected',
  'Cancelled',
]);

const WORKFLOW_TYPES = Object.freeze({
  SINGLE: 'Single Level',
  TWO: 'Two Level',
  THREE: 'Three Level',
  CUSTOM: 'Custom',
});

const APPROVER_ROLES = Object.freeze({
  TEAM_LEAD: 'Team Lead',
  MANAGER: 'Manager',
  HR: 'HR',
});

const UK_REGIONS = Object.freeze(['England', 'Scotland', 'Wales', 'Northern Ireland']);

module.exports = {
  ATTENDANCE_STATUSES,
  REGULARIZATION_STATUSES,
  WORKFLOW_TYPES,
  APPROVER_ROLES,
  UK_REGIONS,
};
