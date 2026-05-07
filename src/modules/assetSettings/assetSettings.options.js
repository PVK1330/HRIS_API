'use strict';

module.exports = {
  VALID_ASSIGNING_RULES: ['Manager assigns', 'HR assigns', 'Auto-assign', 'Employee requests'],
  VALID_RETURN_RULES: [
    'On last day',
    'On notice period start',
    '7 days before exit',
    'Immediate',
  ],
  VALID_LOST_DAMAGED_POLICIES: ['Employee pays', 'Company absorbs', 'Insurance claim', 'Shared cost'],
  VALID_APPROVAL_WORKFLOWS: ['Manager → HR', 'HR only', 'Manager only', 'Auto-approve'],
};
