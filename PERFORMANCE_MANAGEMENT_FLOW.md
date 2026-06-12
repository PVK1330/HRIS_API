# Performance Management — Organisation Admin Flow

> **Scope:** Multi-tenant SaaS HRIS. This document describes the **end-to-end Performance Management flow from the Organisation (Tenant) Admin perspective**, mapped to the *actual* code in `HRIS_API` (backend) and `HRIS` (frontend). It also lists the gaps that must be closed to make the flow "proper" and production-grade.
>
> Companion docs: [`MULTITENANT_ARCHITECTURE.md`](./MULTITENANT_ARCHITECTURE.md), [`ATTENDANCE_LEAVE_FLOW.md`](./ATTENDANCE_LEAVE_FLOW.md), [`NOTIFICATION_LOGIC.md`](./NOTIFICATION_LOGIC.md).

---

## 1. Where this lives in the SaaS / Multi-Tenant model

Performance Management is a **per-tenant feature module**. Nothing here touches the `public` (superadmin) schema except feature entitlement.

| Layer | Mechanism | Reference |
|-------|-----------|-----------|
| **Feature entitlement** | Tenant must have feature code `performance` / `performance_management` enabled (drives sidebar + module gate) | Frontend `AuthContext.jsx` → `TENANT_FEATURE_CODE_TO_MODULE_KEYS`, `AdminLayout.jsx` |
| **Tenant isolation** | Every request is scoped to the tenant's **own database** via `getTenantDbPool(req.user)` using `db_name` from the verified JWT — never from a client header | `src/middlewares/tenant.middleware.js`, `src/config/db.js` |
| **Tables** | `performance_cycles`, `competencies`, `employee_performance` live **inside each tenant DB** (`src/migrations/tenants/`) | migrations `019`, `041`, `042`, `049–054` |
| **Auth** | `authenticate` → `loadAuthContext` populate `req.user` (id, role, db_name, employeeId, department) and `req.auth` (permissions, scope) | `src/middlewares/auth.middleware.js` |
| **RBAC** | Org Admin (`role = 'admin'`) gets all permissions + `ALL` scope automatically; managers/employees resolved from `rbac_roles` | `src/services/authz.service.js` |

**Golden rule already enforced:** services receive `req.user.db_name` and call `getTenantDbPool()`, so tenant A can never read tenant B's reviews.

---

## 2. Roles in the Performance flow

| Role | `role` value | What they do in Performance | Data scope |
|------|--------------|------------------------------|------------|
| **Organisation Admin** (HR Admin) | `admin` | Owns the whole cycle: defines cycles, competencies, assigns assessments, approves final assessments, exports reports | `ALL` (whole tenant) |
| **Manager** | `manager` | Sets goals/KPIs for their department's assigned assessments, reviews team | `TEAM` / department they manage |
| **Employee** | `employee` | Updates own progress against assigned goals | `SELF` |

---

## 3. Data Model (tenant DB)

### 3.1 `performance_cycles` — the review window (Admin-owned)
`019_create_performance_cycles_table.sql`

| Column | Notes |
|--------|-------|
| `cycle_name`, `start_date`, `end_date`, `submission_deadline` | Defines the review window |
| `automated_reminder` BOOLEAN | Toggle for reminder automation (see Gap #4) |
| `status` | `UPCOMING` / `ACTIVE` / `COMPLETED` (computed from dates) |
| `completion_percentage` | 0–100 roll-up |
| `created_by/updated_by/created_at/updated_at/deleted_at` | Audit + soft delete |

### 3.2 `competencies` — rating dimensions (Admin-owned)
`041_create_competency_table.sql` — simple master list (`competency_name` UNIQUE) used to build the rating form.

### 3.3 `employee_performance` — the assessment record (the heart of the flow)
`042` + alters `049–054`. One row per **(employee, cycle)** (enforced by a duplicate check in the controller).

| Group | Columns | Owner of the data |
|-------|---------|-------------------|
| Linkage | `employee_id`, `performance_cycle_id`, `department_id`, `manager_id` | Admin (at assignment) |
| Admin assessment | `competency_ratings` JSONB (1–5 each), `overall_rating`, `key_contributions`, `growth_objectives`, `performance_band` (`Outstanding/Exceeds/Meets/Needs Improvement`), `performance_lead`, `remarks`, `assessment_date`, `status` (`Pending`/`Completed`) | **Admin** |
| Manager goals | `goal_title`, `kpi_target`, `weightage` (1–100), `due_date`, `priority`, `manager_status` | **Manager** |
| Employee progress | `employee_status` (`Not Started/In Progress/Completed/On Hold` — *and* `Approved` set by approve), `employee_progress` (0–100), `employee_comments`, `completion_notes`, `employee_updated_at` | **Employee** |
| Approval | `approved_by`, `approved_at` | **Admin** |

> ⚠️ **Note:** `approve()` sets `employee_status = 'Approved'`, which is **not** in the CHECK constraint added in `052` (`Not Started/In Progress/Completed/On Hold`). This works today only because Postgres `CHECK` was defined on those values — confirm the constraint actually permits `'Approved'` or relax it. See Gap #2.

---

## 4. API Surface (as mounted in `src/app.js`)

| Base path | Router | Auth applied |
|-----------|--------|--------------|
| `/api/v1/performance-cycles` | `modules/performanceCycles/performanceCycles.routes.js` | `authenticate`, `loadAuthContext`, **`requirePermission`** |
| `/api/v1/employee-performance` (+ `/api/...`) | `routes/employeePerformanceRoutes.js` | `authenticate`, `loadAuthContext` only — **no per-route permission gate** ⚠️ |
| `/api/v1/manager/performance` | `routes/managerPerformanceRoutes.js` | `authenticate`, `loadAuthContext` |
| `/api/v1/performance` (export) | `routes/performance.routes.js` | `authenticate`, `loadAuthContext` |

### 4.1 Performance Cycles (Admin)
| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/performance-cycles/summary` | `PERFORMANCE_VIEW` | Active/Upcoming/Completed counts |
| GET | `/performance-cycles` | `PERFORMANCE_VIEW` | List + search/filter/paginate |
| GET | `/performance-cycles/:id` | `PERFORMANCE_VIEW` | Single cycle |
| POST | `/performance-cycles` | `PERFORMANCE_MANAGE` ⚠️ | Create cycle |
| PUT | `/performance-cycles/:id` | `PERFORMANCE_MANAGE` ⚠️ | Update cycle |
| DELETE | `/performance-cycles/:id` | `PERFORMANCE_MANAGE` ⚠️ | Soft delete |

### 4.2 Assessments (`employee-performance`)
| Method | Endpoint | Actor | Purpose |
|--------|----------|-------|---------|
| GET | `/summary` | Admin | Total / Pending / Completed metrics |
| GET | `/` | Admin | List all assessments (search/sort/paginate) |
| POST | `/` | Admin | **Create/assign** assessment (dup-checked per employee+cycle) |
| GET | `/:id` | Admin | Single assessment |
| PUT | `/:id` | Admin | Edit assessment |
| DELETE | `/:id` | Admin | Soft delete |
| GET | `/performance-cycles/dropdown` | Any | Cycle options |
| GET | `/competencies/dropdown` | Any | Competency options |
| GET | `/manager` | Manager | Assessments assigned to logged-in manager |
| PATCH | `/:id/manager-goals` | Manager | Set goal/KPI/weightage/due/priority/status |
| GET | `/employee/:employeeId` | Employee | Own assessments |
| GET | `/performance-summary/:employeeId` | Employee | Own summary |
| PUT | `/:id/progress` | Employee | Update progress/status/comments |
| **PATCH** | **`/:id/approve`** | **Admin** | **Final approval → `employee_status = 'Approved'`** |

### 4.3 Manager & Export
- `GET /manager/performance/reviews`, `/reviews/:id`, `/department` — manager review portal.
- `GET /performance/cycles`, `POST /performance/export` — export report data.

---

## 5. The Proper End-to-End Flow (Org Admin centric)

```
        ┌─────────────────────── ORGANIZATION ADMIN ───────────────────────┐
        │                                                                    │
 (1) Define Competencies        (2) Create Performance Cycle                 │
     POST /competencies              POST /performance-cycles                │
        │                                  │ status: UPCOMING→ACTIVE         │
        └───────────────┬──────────────────┘                                │
                        ▼                                                     │
 (3) Assign Assessments to employees for the ACTIVE cycle                    │
     POST /employee-performance  (employee_id + cycle_id, dup-checked)       │
        │  auto-captures department_id + manager_id                          │
        ▼                                                                     │
        │                                                                    │
 ┌──────┴──────────┐        ┌──────────────────────┐                         │
 │   MANAGER       │        │      EMPLOYEE        │                          │
 │ GET /manager    │        │ GET /employee/:id    │                          │
 │ PATCH /:id/     │        │ PUT /:id/progress    │                          │
 │   manager-goals │  ───►  │  employee_status:    │                          │
 │ sets goal/KPI/  │        │  Not Started→        │                          │
 │ weightage/due   │        │  In Progress→        │                          │
 │ manager_status  │        │  Completed           │                          │
 └──────┬──────────┘        └──────────┬───────────┘                         │
        │                              │                                      │
        └──────────────┬───────────────┘                                      │
                       ▼                                                       │
 (4) Admin reviews + records competency ratings (1–5), band, contributions    │
     PUT /employee-performance/:id   status: Pending → Completed              │
                       ▼                                                       │
 (5) Admin APPROVES                                                            │
     PATCH /employee-performance/:id/approve                                   │
     → employee_status = 'Approved', approved_by, approved_at                  │
                       ▼                                                       │
 (6) Admin EXPORTS / reports + cycle rolls to COMPLETED                        │
     POST /performance/export                                                  │
        └────────────────────────────────────────────────────────────────────┘
```

### Step-by-step (what the Admin does in the UI)

**Step 1 — Set up rating dimensions (Competency Ratings tab)**
Admin manages the `competencies` master list. These become the per-row sliders (1–5) on every assessment.

**Step 2 — Create the Performance Cycle (Performance Cycle tab)**
Admin creates a cycle (`cycle_name`, `start/end/submission_deadline`, `automated_reminder`). Status is derived: `UPCOMING` before start, `ACTIVE` within the window, `COMPLETED` after end. Requires `PERFORMANCE_MANAGE`.

**Step 3 — Assign assessments (Employee Performance tab → "New Assessment")**
Admin picks employee(s) + the cycle. On create:
- Duplicate guard: one assessment per `(employee_id, performance_cycle_id)`.
- `department_id` and `manager_id` are captured so the row routes to the right manager.
- Initial `status` defaults to `Completed` for direct admin entry, or `Pending` if left open; `employee_status` defaults to `Not Started`.

**Step 4 — Manager sets goals** (`PATCH /:id/manager-goals`)
The assigned manager (matched by `manager_id`) adds `goal_title`, `kpi_target`, `weightage` (1–100), `due_date`, `priority`, `manager_status`. All six are **required** by the controller validation.

**Step 5 — Employee executes & reports progress** (`PUT /:id/progress`)
Employee moves `employee_status` `Not Started → In Progress → Completed`, sets `employee_progress` (0–100), adds `employee_comments` / `completion_notes`.

**Step 6 — Admin assesses & scores** (`PUT /:id`)
Admin records `competency_ratings` (1–5 each, validated), `overall_rating`, `performance_band`, `key_contributions`, `growth_objectives`, `remarks`; flips `status` to `Completed`.

**Step 7 — Admin approves** (`PATCH /:id/approve`)
Sets `employee_status = 'Approved'`, stamps `approved_by` + `approved_at`. This is the terminal state.

**Step 8 — Report & close**
Admin exports (`POST /performance/export`) and, once `end_date` passes, the cycle reads as `COMPLETED`.

---

## 6. Status State Machines

**Performance Cycle (`performance_cycles.status`)** — date-derived:
```
UPCOMING ──(today ≥ start_date)──► ACTIVE ──(today > end_date)──► COMPLETED
```

**Assessment — Admin track (`status`)**:
```
Pending ──(admin completes scoring)──► Completed
```

**Assessment — Employee track (`employee_status`)**:
```
Not Started ──► In Progress ──► Completed ──(admin approves)──► Approved
                      │
                      └──► On Hold ──► In Progress
```

---

## 7. Frontend (Organisation Admin)

| Concern | File |
|---------|------|
| Sidebar entry (HR OPERATIONS group, `key: performance`, `featureCode: performance`) | `src/layouts/AdminLayout.jsx` |
| Route `/admin/performance` behind `AdminModuleGate` | `src/routes/AppRouter.jsx` |
| **Admin page (4 tabs)** | `src/pages/admin/hr/Performance.jsx` |
| Manager page | `src/pages/admin/hr/ManagerPerformance.jsx` |
| Modals | `src/components/performance/{AssessmentDetailsModal, ManagerAssessmentModal, ManagerGoalUpdatesTable}.jsx` |
| API services | `src/services/{performanceCyclesAPI, performanceAssessmentAPI, competenciesAPI}.js` |
| Axios (auth token injected from `localStorage.hris_token`) | `src/services/api.js` |

**Admin page tabs** (`Performance.jsx`):
1. **Employee Performance** (`hub`) — assessments table (Employee, Cycle, Employee Status, Progress, Action) + create/approve.
2. **Performance Cycle** (`cycles`) — cycle CRUD + summary cards (Active/Upcoming/Completed).
3. **Competency Ratings** (`compCycle`) — competency master + summary.
4. **Performance Reports** (`analytics`) — charts/export.

---

## 8. Multi-Tenant & Security checklist (status in current code)

| Control | Status | Note |
|---------|:------:|------|
| Tenant DB resolved from JWT `db_name` (`getTenantDbPool`) | ✅ | Applied in every controller |
| Cycles routes gated by RBAC permission | ✅ | `requirePermission(PERFORMANCE_VIEW / PERFORMANCE_MANAGE)` |
| `employee-performance` routes gated by RBAC permission | ✅ **(fixed)** | Per-route `requirePermission` / `requireAnyPermission` added |
| Manager review + export routes gated | ✅ **(fixed)** | `managerPerformanceRoutes` + `performance.routes` now permission-gated |
| Self-approval blocked | ✅ **(fixed)** | `approveAssessment` rejects approving your own assessment |
| Data-scope enforced on assessment list (manager sees only team) | ⚠️ | Manager list filters by `manager_id`; admin list is unscoped (intended for `ALL`) but employee/manager reads should use `appendScopeToConditions` |
| Soft delete + audit columns | ✅ | `deleted_at`, `created_by/updated_by`, `approved_by/at` |
| Duplicate-assignment guard | ✅ | `(employee_id, performance_cycle_id)` |
| Notifications on assign/approve | ❌ | Not wired (Gap #4 — still open) |

---

## 9. Gaps — status after fixes

### ✅ Fixed in this change-set

1. **Permission-gated `employeePerformanceRoutes.js`.** Every route now carries `requirePermission` / `requireAnyPermission`:
   - reads / dropdowns / summary → `PERFORMANCE_VIEW`
   - create / update / delete → `PERFORMANCE_MANAGE`
   - `/:id/approve` → `PERFORMANCE_APPROVE`
   - `/:id/manager-goals` → `PERFORMANCE_REVIEW`
   - `/:id/progress`, `/employee/:id` → `PERFORMANCE_VIEW_OWN` (falls back to `PERFORMANCE_VIEW`)
   - `managerPerformanceRoutes.js` + `performance.routes.js` (export) also gated.

2. **Permission constants defined.** `src/constants/permissions.js` now defines `PERFORMANCE_VIEW_OWN`, `PERFORMANCE_VIEW_TEAM`, `PERFORMANCE_MANAGE`, `PERFORMANCE_REVIEW`, `PERFORMANCE_APPROVE`, and maps them through `LEGACY_KEY_TO_ACTIONS['performance']` + `ACTION_TO_LEGACY_KEYS`. This also means **existing roles holding the legacy `performance` module satisfy the new gates automatically** (via `permissionSatisfied` expansion), so the change is backward-compatible. Migration `107_performance_permissions.sql` seeds the granular `rbac_permissions` rows and grants them to roles by data scope (ALL → full, TEAM/DEPARTMENT → view+review, SELF → view own).

3. **`employee_status` CHECK constraint** relaxed to include `'Approved'` — migration `108_employee_performance_approved_status.sql` drops and re-adds `employee_performance_employee_status_check`.

4. **Self-approval blocked.** `approveAssessment` now rejects (`403`) when the approver's `employeeId` equals the assessment's `employee_id`.

### ✅ Also completed (functionality pass)

1. **Assessment-lifecycle notifications wired** in `employeePerformanceController.js` (push + email via `notifications.service.sendSystemNotification`):
   - **Assign** (`createAssessment`) → employee + manager.
   - **Manager goal set** (`updateManagerGoals`) → employee.
   - **Employee marks Completed** (`updateEmployeeProgress`) → admins (for-admin broadcast).
   - **Approve** (`approveAssessment`) → employee.
   - (Cycle create/update/delete notifications were already wired in `performanceCycles.service.js`.)
2. **CSV export fixed.** `performanceExport.service.js` now implements `generateCsv()` (was called but undefined → would crash on `exportType='csv'`).
3. **Competency UPDATE** added end-to-end: model `Competency.update`, `PUT /competencies/:id` (permission-gated), `competenciesAPI.updateCompetency`, and edit wired in the Competency Ratings tab.
4. **Performance Reports tab now uses real data.** New `GET /employee-performance/analytics` returns tenant-scoped aggregates (assessments by department, performance-band distribution, status breakdown, average rating per cycle, headline KPIs); the Reports tab charts consume it instead of hardcoded mock data.

### ⏳ Still open (recommended next)

1. **Automated cycle reminders.** Honor `performance_cycles.automated_reminder` with a cron job (`src/jobs/`) firing before `submission_deadline`.
2. **Data-scope on manager/employee reads.** Apply `appendScopeToConditions` to assessment list/read queries so cross-team data can't leak even if a route is mis-permissioned.
3. **Overall rating derivation.** `overall_rating` / `performance_band` are free entry; consider computing `overall_rating` from weighted `competency_ratings` (× `weightage`) for consistency.

---

## 10. Quick reference — file map

```
Backend (HRIS_API)
  src/app.js                                     # route mounting (§4)
  src/constants/permissions.js                   # PERFORMANCE_* (incomplete — Gap #2)
  src/middlewares/auth.middleware.js             # authenticate, loadAuthContext, requirePermission
  src/middlewares/tenant.middleware.js           # tenant resolution
  src/modules/performanceCycles/                 # cycle CRUD (routes/controller/service/repo/validator)
  src/routes/employeePerformanceRoutes.js        # assessments + manager-goals + progress + approve
  src/routes/managerPerformanceRoutes.js         # manager review portal
  src/routes/performance.routes.js               # export
  src/controllers/employeePerformanceController.js
  src/models/EmployeePerformance.js              # incl. approve()
  src/migrations/tenants/019,041,042,049-054     # schema

Frontend (HRIS)
  src/layouts/AdminLayout.jsx                     # sidebar entry
  src/routes/AppRouter.jsx                        # /admin/performance route + module gate
  src/pages/admin/hr/Performance.jsx             # admin 4-tab page
  src/pages/admin/hr/ManagerPerformance.jsx
  src/components/performance/*                     # modals/tables
  src/services/performanceCyclesAPI.js
  src/services/performanceAssessmentAPI.js
  src/services/competenciesAPI.js
```
