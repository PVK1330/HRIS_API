'use strict';

const ApiError = require('../../../utils/ApiError');
const { buildApprovalChain } = require('./attendanceWorkflow.service');

async function createSteps(client, attendanceId, settings) {
  const levels = buildApprovalChain(settings);
  for (let i = 0; i < levels.length; i += 1) {
    await client.query(
      `INSERT INTO attendance_regularization_steps
         (attendance_id, level, approver_role, status)
       VALUES ($1, $2, $3, 'Pending')
       ON CONFLICT (attendance_id, level) DO NOTHING`,
      [attendanceId, i + 1, levels[i]],
    );
  }
  return levels.length;
}

async function getPendingStep(client, attendanceId) {
  const { rows } = await client.query(
    `SELECT * FROM attendance_regularization_steps
     WHERE attendance_id = $1 AND status = 'Pending'
     ORDER BY level ASC LIMIT 1
     FOR UPDATE`,
    [attendanceId],
  );
  return rows[0] || null;
}

async function countPendingSteps(client, attendanceId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM attendance_regularization_steps
     WHERE attendance_id = $1 AND status = 'Pending'`,
    [attendanceId],
  );
  return rows[0].cnt;
}

async function advanceOrComplete(client, attendanceId, actorEmployeeId, remarks, action) {
  const step = await getPendingStep(client, attendanceId);
  if (!step) {
    throw ApiError.badRequest(
      'Regularization workflow has no pending steps; cannot process approval',
    );
  }

  const stepStatus = action === 'approve' ? 'Approved' : 'Rejected';
  await client.query(
    `UPDATE attendance_regularization_steps
     SET status = $1, acted_by = $2, acted_at = NOW(), remarks = $3
     WHERE id = $4`,
    [stepStatus, actorEmployeeId, remarks || null, step.id],
  );

  if (action === 'reject') {
    return { done: true, finalStatus: 'Rejected', completedStep: step };
  }

  const remaining = await countPendingSteps(client, attendanceId);
  if (remaining === 0) {
    return { done: true, finalStatus: 'Approved', completedStep: step };
  }
  return {
    done: false,
    finalStatus: 'Pending',
    currentLevel: step.level + 1,
    completedStep: step,
  };
}

module.exports = {
  buildApprovalChain,
  createSteps,
  getPendingStep,
  countPendingSteps,
  advanceOrComplete,
};
