'use strict';

const EventEmitter = require('events');
class ExitEventPublisher extends EventEmitter {}

const exitEvents = new ExitEventPublisher();

const EVENTS = {
  WORKFLOW_STARTED: 'WORKFLOW_STARTED',
  STEP_ACTIVATED: 'STEP_ACTIVATED',
  STEP_APPROVED: 'STEP_APPROVED',
  STEP_REJECTED: 'STEP_REJECTED',
  STEP_SKIPPED: 'STEP_SKIPPED',
  SLA_BREACHED: 'SLA_BREACHED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  WORKFLOW_REJECTED: 'WORKFLOW_REJECTED'
};

module.exports = {
  exitEvents,
  EVENTS
};
