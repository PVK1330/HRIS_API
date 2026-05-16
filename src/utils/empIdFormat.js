'use strict';

const EMP_ID_PREFIX = 'EMP-';

function parseEmpIdSequence(empId) {
  if (empId == null || empId === '') return 0;
  const s = String(empId).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

function formatEmpId(sequence) {
  const n = parseInt(String(sequence), 10);
  if (!Number.isFinite(n) || n < 1) return `${EMP_ID_PREFIX}1`;
  return `${EMP_ID_PREFIX}${n}`;
}

module.exports = {
  EMP_ID_PREFIX,
  parseEmpIdSequence,
  formatEmpId,
};
