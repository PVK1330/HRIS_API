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

    // Insert a fresh target-year balance, or reconcile an existing row (e.g. the employee already
    // applied for leave in the new year). We never clobber `used`, and total_allocated is
    // RECONCILED to the leave type's CURRENT annual entitlement on every run — `total_allocated`
    // is just the annual figure (carry lives separately in `carry_forward`), so assigning the
    // fresh value is a refresh, not an addition: no double-counting. The old "only seed when 0"
    // rule froze total_allocated at its first value, so a mid-year entitlement change never
    // propagated and total_allocated drifted out of sync with the entitlement on re-run.
    await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type, year, total_allocated, used, carry_forward)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (employee_id, leave_type, year) DO UPDATE SET
         carry_forward   = EXCLUDED.carry_forward,
         total_allocated = EXCLUDED.total_allocated,
         updated_at      = NOW()`,
      [r.employee_id, r.leave_type, year, annual, carry],
    );

    processed += 1;
    if (carry > 0) carried += 1;
  }

  return { targetYear: year, prevYear, processed, carried };
}

/**
 * Targeted carry-forward reconcile for ONE employee + leave type across the year chain
 * (startYear → endYear). Recomputes each subsequent year's `carry_forward` from the prior year's
 * (now-corrected) remaining, capped at the leave type's max_carry_forward — so when a cross-year
 * leave cancellation restores `used` in a closed prior year, those freed days propagate forward
 * into the employee's active balance without re-sweeping the whole tenant. Carry is a fresh
 * min(remaining, cap) each step, never additive → no double-counting. `db` may be a pool or a
 * transaction client.
 */
async function reconcileEmployeeCarryForward(db, employeeId, leaveType, startYear, endYear) {
  for (let y = startYear; y < endYear; y += 1) {
    const { rows } = await db.query(
      `SELECT lb.total_allocated, lb.used, lb.carry_forward,
              lt.annual_entitlement_days, lt.carry_forward_allowed, lt.max_carry_forward_days
         FROM leave_balances lb
         JOIN leave_types lt
           ON LOWER(TRIM(lt.name)) = LOWER(TRIM(lb.leave_type)) AND lt.is_active = true
        WHERE lb.employee_id = $1 AND LOWER(TRIM(lb.leave_type)) = LOWER(TRIM($2)) AND lb.year = $3`,
      [employeeId, leaveType, y],
    );
    if (!rows.length) continue; // no source-year balance → nothing to carry forward
    const r = rows[0];
    const carryAllowed = r.carry_forward_allowed !== false;
    const remaining = Math.max(0, (r.total_allocated + r.carry_forward) - r.used);
    const cap = Math.max(0, r.max_carry_forward_days || 0);
    const carry = carryAllowed ? Math.max(0, Math.min(remaining, cap)) : 0;
    const annual = Math.max(0, r.annual_entitlement_days || 0);
    // Seed the next year's balance if absent, else just refresh its carry_forward (preserve used).
    await db.query(
      `INSERT INTO leave_balances (employee_id, leave_type, year, total_allocated, used, carry_forward)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (employee_id, leave_type, year) DO UPDATE SET
         carry_forward = EXCLUDED.carry_forward,
         updated_at    = NOW()`,
      [employeeId, leaveType, y + 1, annual, carry],
    );
  }
}

module.exports = { processCarryForward, reconcileEmployeeCarryForward };
