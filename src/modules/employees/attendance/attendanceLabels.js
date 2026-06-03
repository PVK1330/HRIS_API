'use strict';

const FIELD_LABELS = {
  employee_id: 'Employee ID',
  employee_name: 'Employee',
  full_name: 'Employee',
  emp_id: 'Employee ID',
  department: 'Department',
  job_title: 'Designation',
  work_location: 'Location',
  date: 'Date',
  check_in_time: 'Check-in',
  check_out_time: 'Check-out',
  work_mode: 'Work mode',
  status: 'Status',
  total_hours: 'Total hours',
  worked_hours: 'Worked hours',
  overtime_hours: 'Overtime (hrs)',
  late_minutes: 'Late (mins)',
  late_count: 'Late count',
  regularization_status: 'Regularization',
  regularization_reason: 'Reason',
  present: 'Present',
  absent: 'Absent',
  on_leave: 'On leave',
  leave_days: 'Leave days',
  payable_days: 'Payable days',
  working_days: 'Working days',
  present_days: 'Present days',
  absent_days: 'Absent days',
  total_records: 'Total records',
  employees: 'Employees',
};

function labelForField(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = { FIELD_LABELS, labelForField };
