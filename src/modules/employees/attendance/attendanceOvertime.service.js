'use strict';

/**
 * Overtime payable hours from attendance_settings.overtime_calculation_rule (no hardcoded multipliers).
 */

function resolveOvertimeMultiplier(settings) {
  if (!settings) return 1;
  const rule = String(settings.overtime_calculation_rule || '').trim();
  const custom = Number(settings.overtime_custom_multiplier);

  // The Overtime Pay Multiplier (overtime_custom_multiplier) is now the single rate
  // control in settings — prefer it when set; fall back to the legacy rule string.
  if (Number.isFinite(custom) && custom > 0) return custom;

  const nxMatch = rule.match(/(\d+(?:\.\d+)?)\s*x/i);
  if (nxMatch) {
    const parsed = parseFloat(nxMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const lower = rule.toLowerCase();
  if (lower.includes('custom')) {
    return Number.isFinite(custom) && custom > 0 ? custom : 1;
  }
  if (lower.includes('flat') || lower.includes('standard')) {
    return 1;
  }

  return 1;
}

/**
 * @param {number} rawOvertimeHours - hours beyond threshold before multiplier
 * @returns {{ raw_hours, multiplier, overtime_hours }}
 */
function calculateOvertimeHours(settings, rawOvertimeHours) {
  const raw = Math.max(0, Number(rawOvertimeHours) || 0);
  const multiplier = resolveOvertimeMultiplier(settings);
  const overtime_hours = parseFloat((raw * multiplier).toFixed(2));
  return { raw_hours: raw, multiplier, overtime_hours };
}

module.exports = {
  resolveOvertimeMultiplier,
  calculateOvertimeHours,
};
