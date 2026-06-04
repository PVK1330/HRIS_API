'use strict';

/**
 * Leave carry-forward — roll unused leave balances into the next leave year.
 *
 * For every previous-year balance of an ACTIVE leave type:
 *   remaining = max(0, total_allocated + carry_forward - used)
 *   carry     = min(remaining, leave_type.max_carry_forward_days)
 * and the target-year balance is (re)seeded with a fresh annual entitlement plus the
 * carried days. The computation is deterministic, so re-running the job is idempotent.
 */

async function processCarryForward(pool, targetYear) {
  const year = parseInt(targetYear, 10) || new Date().getFullYear();
  const prevYear = year - 1;

   const { rows } = await pool.query(
    `SELECT lb.employee_id, lb.leave_type,
            lb.total_allocated, lb.used, lb.carry_forward,
            lt.annual_entitlement_days, lt.carry_forward_allowed, lt.max_carry_forward_days
     FROM leave_balances lb
     JOIN leave_types lt
       ON LOWER(TRIM(lt.name)) = LOWER(TRIM(lb.leave_type))
      AND lt.is_active = true
     WHERE lb.year = $1`,
    [prevYear],
  );

  let processed = 0;
  let carried = 0;

  for (const r of rows) {
    const carryAllowed = r.carry_forward_allowed !== false;
    const remaining = Math.max(0, (r.total_allocated + r.carry_forward) - r.used);
    const cap = Math.max(0, r.max_carry_forward_days || 0);
    const carry = carryAllowed ? Math.max(0, Math.min(remaining, cap)) : 0;
    const annual = Math.max(0, r.annual_entitlement_days || 0);

    // Insert a fresh target-year balance, or just refresh its carry-forward if the row
    // already exists (e.g. employee already applied for leave in the new year). We never
    // clobber `used` on an existing row, and only seed total_allocated when it is still 0.
    await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type, year, total_allocated, used, carry_forward)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (employee_id, leave_type, year) DO UPDATE SET
         carry_forward   = EXCLUDED.carry_forward,
         total_allocated = CASE WHEN leave_balances.total_allocated = 0
                                THEN EXCLUDED.total_allocated
                                ELSE leave_balances.total_allocated END,
         updated_at      = NOW()`,
      [r.employee_id, r.leave_type, year, annual, carry],
    );

    processed += 1;
    if (carry > 0) carried += 1;
  }

  return { targetYear: year, prevYear, processed, carried };
}

module.exports = { processCarryForward };
