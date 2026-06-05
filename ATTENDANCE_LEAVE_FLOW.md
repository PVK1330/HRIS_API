# Attendance & Leave — System Flow

_How the Attendance and Leave modules work end-to-end in the current HRIS (frontend `HRIS`, backend `HRIS_API`). Grounded in the live code as of June 2026, including the recent security/data-integrity fixes._

---

## 0. Cross-cutting context

**SaaS multi-tenancy.** Database-per-tenant. Every authenticated request carries a JWT with `db_name`; services resolve their connection pool via `getTenantPool(user.db_name)`. The tenant is derived **strictly from the verified JWT** for normal users — client-supplied `x-tenant-id` headers are ignored ([tenant.middleware.js](src/middlewares/tenant.middleware.js)).

**Auth pipeline** (every admin route): `authenticate` → `loadAuthContext` → `requirePermission(...)`.
- `authenticate` verifies the JWT, populates `req.user`.
- `loadAuthContext` loads `req.auth = { permissions, scope, employeeId, department, managedDepartmentId, isTenantAdmin }`.
- `requirePermission` / `requireAnyPermission` gate the route server-side (the frontend `PermissionGate` is cosmetic only).

**Data scope** (`req.auth.scope`): `SELF` → own records · `TEAM` → direct reports (+ managed department) · `DEPARTMENT` → whole department · `ALL` / tenant admin → everything. Enforced in SQL via `applyDataScope.js` and on single records via `assertEmployeeRecordAccess`.

---

## 1. Attendance Module

### 1.1 Data model (key tables)

| Table | Purpose | Migration |
|---|---|---|
| `attendance` | one row per (employee, date): punches, status, hours, OT, regularization, paid_day | `003`, `090`, `095` |
| `attendance_settings` | per-tenant config: work hours, grace, OT rules, approver | `012`, `092` |
| `attendance_regularization_steps` | multi-level regularization approval chain | `090` |
| `attendance_monthly_report_log` | idempotency log for the monthly late/early email | `101` |
| `attendance_notification_history` | dedupe attendance notifications | `098` |

### 1.2 Check-In / Check-Out (employee portal)

```
Employee portal                Backend
──────────────                 ───────
[Check In]  ──POST /attendance/check-in──▶ requirePermission(ATTENDANCE_CREATE)
                                          → attendance.service.checkIn()
                                            • assertActiveForPunch (employee must be active)
                                            • compute status vs work_start_time + grace
                                            • repo.upsert  ON CONFLICT (employee_id, date)
[Check Out] ──POST /attendance/check-out─▶ attendance.service.checkOut()
                                            • compute worked_hours / total_hours
                                            • compute overtime_hours (vs configured hours)
                                            • if overtime > 0 → markOvertimePending  ─┐
                                                                                       │ see 1.4
```

- UI: [AttendancePunchCard.jsx](../HRIS/src/components/attendance/AttendancePunchCard.jsx) → `attendanceService.checkIn/checkOut`.
- Status (`Present` / `Late` / `Half Day` …) is derived in `attendanceCalculation.service.js` from the tenant's configured `work_start_time`, `min_hours_for_present`, `break_duration_minutes`, and grace settings.

### 1.3 Daily working hours — Admin configuration

```
Settings → Attendance  ─PUT /attendance-settings─▶ requireAnyPermission(ATTENDANCE_SETTINGS_MANAGE, ATTENDANCE_MANAGE)
[AttendanceSection.jsx]                            → attendanceSettings.service.update (tenant-scoped, validated)
```
Configurable: `work_start_time`, `work_end_time`, `break_duration_minutes`, `min_hours_for_present`, `grace_days_per_month`, overtime rules, approver, early-departure rule. These values feed the calculation engine and the monthly report thresholds.

> Note: `total_required_hours` and `auto_calculate_hours` are stored but only partially consumed by the calc engine (gap flagged in the audit).

### 1.4 Overtime approval flow

```
            check-out with OT
                  │
                  ▼
        overtime_status = 'Pending'
        notifyOtRequested → reporting_manager_id
                  │
        Manager opens OvertimeApprovals.jsx
        GET /attendance/overtime/pending
                  │
        PATCH /attendance/:id/overtime { action: approve|reject }
        (perm: ATTENDANCE_APPROVE | ATTENDANCE_REJECT | ATTENDANCE_MANAGE)
                  │
        attendance.service.processOvertime()
          • assertNotSelfApproval  ← (fix) cannot approve own OT
          • assertCanModifyEmployee (scope check)
          ├─ approve → status 'Approved', overtime_forwarded_at set
          │            notifyOtApproved → employee
          │            notifyOtForwardedToDept → department manager   ← "forward to department"
          └─ reject  → status 'Rejected', notifyOtRejected → employee
```

**State:** `Pending → Approved | Rejected`. The "forward to department" step is a **notification** to the department manager (not a second approval gate).

### 1.5 Late arrival & early exit — monthly report

```
Cron  '0 2 1 * *'  (1st of month, 02:00)   jobs/attendanceMonthlyReport.job.js
   └─ for each active tenant:
        attendanceMonthlyReport.service:
          • aggregate previous month per department:
              late days/minutes (work_start + grace), early-exit days/minutes (work_end)
          • build HTML table
          • email → departments.manager_id → employees.work_email   (HR fallback)
          • record in attendance_monthly_report_log  UNIQUE(year, month, department)  → idempotent
```
> Backend only — there is no frontend screen to preview/trigger this report yet (gap).

### 1.6 Regularization (correcting a punch)

`POST /attendance/regularization` → multi-level chain in `attendance_regularization_steps`; each level approved via `PATCH /attendance/:id/regularize`. Hierarchy + self-approval enforced by `assertCanActOnPendingStep` (`team_lead` → direct manager, `manager` → department, `hr` → HR scope).

### 1.7 Attendance dashboard & reports

`GET /attendance/dashboard` (widgets, 7-day trend, dept breakdown, top-late, missing-checkout) and `GET /attendance/reports/data?reportType=…` (late, overtime, absenteeism, payroll, …). All queries are **data-scope filtered** so a TEAM/DEPARTMENT user only sees their slice.

---

## 2. Leave Module

### 2.1 Data model (key tables)

| Table | Purpose | Migration |
|---|---|---|
| `leave_types` | per-tenant leave types + `annual_entitlement_days`, accrual, LOP, carry-forward caps | `019`, `041`, `042` |
| `leave_requests` | applications + two-stage approval columns (`manager_approved_*`, `hr_approved_*`) | `004`, `100` |
| `leave_balances` | per (employee, leave_type, year): `total_allocated`, `used`, `carry_forward` | `004` |

### 2.2 Leave configuration — Admin

```
Settings → Leave  ──/admin/settings/leave-types──▶ leaveSettings module (CRUD)
[LeaveSettings.jsx]                                requirePermission('system-settings')
   • create/edit/delete leave types
   • set annual_entitlement_days (allocation), accrual (Monthly|Yearly|None),
     LOP rule (No LOP|Full LOP|Half LOP), carry-forward cap, restrictions
   • editing allocation/name now reconciles into current-year leave_balances  ← (fix)
```

### 2.3 Leave application → two-stage approval workflow

```
Employee applies (AddLeaveModal / LeaveAbsence)
   │  POST /leave   (perm: LEAVE_APPLY)
   ▼
applyLeave():
   • validate leave type active, dates, overlap, notice/gender/probation/service rules
   • balance pre-check (advisory)
   • insert leave_requests  ── status depends on config ──┐
   │                                                       │
   ├─ auto_approval = true  → 'Approved'  (deduct balance now, under row lock)
   ├─ isDraft               → 'Draft'
   └─ otherwise             → 'Pending Manager Approval'
                                       │
                        ┌──────────────┘
                        ▼
   ╔═══════════════════ STATE MACHINE (PATCH /leave/:id) ═══════════════════╗
   ║                                                                         ║
   ║  Draft ──submit──▶ Pending Manager Approval                             ║
   ║                          │                                              ║
   ║         manager approve  │  (perm LEAVE_APPROVE; cannot self-approve)   ║
   ║                          ▼                                              ║
   ║                  Pending HR Approval                                    ║
   ║                          │                                              ║
   ║           HR approve     │  (isHrActor: admin/hr roles)                 ║
   ║                          ▼                                              ║
   ║                      Approved   ──▶ balance deducted (FOR UPDATE)       ║
   ║                                                                         ║
   ║   reject@manager → 'Rejected by Manager'                                ║
   ║   reject@HR      → 'Rejected by HR'                                     ║
   ║   cancel         → 'Cancelled'  (restore balance if was Approved)       ║
   ╚═════════════════════════════════════════════════════════════════════════╝
```

- **Stage 1 — Manager:** `Pending Manager Approval → Pending HR Approval`. Approver needs `LEAVE_APPROVE`; a literal `manager` role is restricted to their direct reports; **self-approval blocked** (fix).
- **Stage 2 — HR:** `Pending HR Approval → Approved`. Restricted to HR/admin actors (`isHrActor`). **Balance is consumed only here**, inside a transaction.
- Notifications fire at each transition (`sendSystemNotification`).

Code: [leave.service.js](src/modules/employees/leave/leave.service.js) `applyLeave` / `processLeave`.

### 2.4 Leave balance management

```
seed:      ensureBalance() seeds leave_balances from leave_types.annual_entitlement_days
apply:     remaining = total_allocated + carry_forward − used  (checked under FOR UPDATE)
approve:   used += total_days        (atomic incrementUsed, row-locked)  ← (fix: no lost-update)
cancel:    used −= total_days        (clamped at 0, row-locked)
reject:    no change (never deducted)
```
Concurrency-safe via `repo.lockBalanceForUpdate` (`SELECT … FOR UPDATE`) + `repo.incrementUsed` (atomic delta).

### 2.5 Carry-forward (year rollover)

```
Cron  '30 0 1 1 *'  (Jan 1, 00:30)   jobs/leaveCarryForward.job.js
   └─ for each tenant: leaveCarryForward.service.processCarryForward(targetYear)
        • for types with carry_forward_allowed:
            carry = min(unused, max_carry_forward_days) → next year's carry_forward
        • idempotent; never clobbers `used`
Manual re-run: POST /leave/carry-forward  (perm LEAVE_APPROVE)
```
> No expiry/lapse window on carried days yet (gap). Calendar-year based.

---

## 3. Endpoint reference

### Attendance (`/api/v1`)
| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/employees/:employeeId/attendance` | any view + scope | employee's own records |
| GET | `/attendance/me/today` | create/view | today's punch state |
| POST | `/attendance/check-in` · `/check-out` | `ATTENDANCE_CREATE` | punch |
| GET | `/attendance/dashboard` | any view | scoped dashboard |
| GET | `/attendance/reports/data` | any view | reports (late/OT/…) |
| GET | `/attendance/overtime/pending` | any view | OT inbox |
| PATCH | `/attendance/:id/overtime` | approve/reject/manage | approve/reject OT |
| POST | `/attendance/regularization` | `ATTENDANCE_REGULARIZATION_REQUEST` | request fix |
| PATCH | `/attendance/:id/regularize` | approve/reject/manage | act on regularization |
| POST | `/attendance/override` | `ATTENDANCE_MANAGE` | admin override |

### Leave (`/api/v1`)
| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/employees/:employeeId/leave` | `LEAVE_VIEW` + scope | employee's leave |
| GET | `/leave` | `LEAVE_VIEW` | admin list (scoped) |
| GET | `/leave/balances` | `LEAVE_VIEW` | balances (scoped) |
| POST | `/leave` | `LEAVE_APPLY` | apply |
| PATCH | `/leave/:id` | `LEAVE_APPROVE` (approve/reject) / `LEAVE_APPLY` (submit/cancel) | workflow action |
| POST | `/leave/carry-forward` | `LEAVE_APPROVE` | manual rollover |
| `*` | `/admin/settings/leave-types` | `system-settings` | leave-type config |

---

## 4. Scheduled jobs summary

| Job | Schedule | Effect |
|---|---|---|
| `attendanceMonthlyReport.job` | `0 2 1 * *` | email prior-month late/early report per department |
| `attendanceCron.job` | (daily) | auto-finalize/auto-reject stale attendance |
| `leaveCarryForward.job` | `30 0 1 1 *` | roll unused leave into the new year |

---

## 5. Known gaps (from audit — backlog, not blockers)

- No frontend to view/trigger the monthly late/early report or manual carry-forward.
- Stage-1 leave notification currently broadcasts to all admins rather than routing to the specific reporting manager.
- `calcDays` counts weekends/holidays; balances are integer-only (no half-day).
- Carried-forward days have a cap but no expiry/lapse window.
- ~20 other `tenantResolver`-mounted routers should be audited for the same header pattern that was fixed for attendance/leave settings.
