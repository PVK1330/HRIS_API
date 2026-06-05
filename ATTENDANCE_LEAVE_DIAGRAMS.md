# Attendance & Leave — Visual Flows (Mermaid)

_Renders in GitHub and VS Code (Markdown Preview Mermaid Support). Companion to [ATTENDANCE_LEAVE_FLOW.md](ATTENDANCE_LEAVE_FLOW.md)._

---

## 1. Request lifecycle — multi-tenant + RBAC pipeline

```mermaid
flowchart LR
    A[Client request<br/>JWT Bearer] --> B[authenticate<br/>verify JWT → req.user]
    B --> C[tenantResolver<br/>tenant from JWT only]
    C --> D[loadAuthContext<br/>permissions + scope]
    D --> E{requirePermission?}
    E -- no --> F[403 Forbidden]
    E -- yes --> G[Controller → Service<br/>getTenantPool db_name]
    G --> H[(Tenant DB<br/>scoped query)]
```

---

## 2. Attendance — Check-In / Check-Out

```mermaid
sequenceDiagram
    actor Emp as Employee
    participant UI as AttendancePunchCard
    participant API as attendance.service
    participant DB as attendance table

    Emp->>UI: Click Check In
    UI->>API: POST /attendance/check-in (ATTENDANCE_CREATE)
    API->>API: assertActiveForPunch
    API->>API: status vs work_start_time + grace
    API->>DB: upsert ON CONFLICT (employee_id, date)
    Emp->>UI: Click Check Out
    UI->>API: POST /attendance/check-out
    API->>API: worked_hours, total_hours
    API->>API: overtime_hours vs configured hours
    alt overtime > 0
        API->>DB: overtime_status = 'Pending'
        API-->>Emp: OT request → reporting manager
    end
```

---

## 3. Overtime approval

```mermaid
stateDiagram-v2
    [*] --> Pending: check-out with OT
    Pending --> Approved: manager approve<br/>(not self · scope check)
    Pending --> Rejected: manager reject
    Approved --> [*]: notify employee +<br/>forward to department
    Rejected --> [*]: notify employee
```

---

## 4. Late / early monthly report (cron)

```mermaid
flowchart TD
    CRON["Cron 0 2 1 * *<br/>(1st of month, 02:00)"] --> LOOP{For each active tenant}
    LOOP --> AGG[Aggregate prior month per department<br/>late days/mins · early-exit days/mins]
    AGG --> HTML[Build HTML report]
    HTML --> CHK{Already sent?<br/>report_log UNIQUE year,month,dept}
    CHK -- yes --> SKIP[Skip - idempotent]
    CHK -- no --> MAIL[Email department manager<br/>HR fallback] --> LOG[Insert report_log]
```

---

## 5. Leave — application + two-stage approval

```mermaid
stateDiagram-v2
    [*] --> Draft: apply with isDraft
    [*] --> PendingMgr: apply (normal)
    [*] --> Approved: apply (auto_approval)

    Draft --> PendingMgr: submit
    PendingMgr --> PendingHR: manager approve<br/>(LEAVE_APPROVE · not self · direct report)
    PendingMgr --> RejectedMgr: manager reject
    PendingHR --> Approved: HR approve<br/>(isHrActor) → deduct balance
    PendingHR --> RejectedHR: HR reject

    Approved --> Cancelled: cancel → restore balance
    PendingMgr --> Cancelled: cancel
    PendingHR --> Cancelled: cancel

    RejectedMgr --> [*]
    RejectedHR --> [*]
    Cancelled --> [*]
    Approved --> [*]

    note right of Approved
        Balance consumed ONLY here,
        in a transaction, row-locked
    end note
```

---

## 6. Leave approval — actors & routing

```mermaid
flowchart TD
    E[Employee applies] --> M[/Pending Manager Approval/]
    M --> MA{Reporting Manager<br/>LEAVE_APPROVE}
    MA -- approve --> H[/Pending HR Approval/]
    MA -- reject --> RJ1[Rejected by Manager]
    H --> HA{HR / Admin<br/>isHrActor}
    HA -- approve --> AP[Approved + balance deducted]
    HA -- reject --> RJ2[Rejected by HR]
    AP --> N[Notify employee]
```

---

## 7. Leave balance lifecycle (concurrency-safe)

```mermaid
flowchart LR
    SEED[Seed from<br/>annual_entitlement_days] --> CHK
    CHK["remaining = allocated + carry_forward − used<br/>(SELECT … FOR UPDATE)"] --> APPLY
    APPLY{Action} -- approve --> DED["used += days<br/>(atomic incrementUsed)"]
    APPLY -- cancel --> RES["used −= days<br/>(clamped ≥ 0)"]
    APPLY -- reject --> NO[no change]
    DED --> CF
    RES --> CF
    CF["Year-end carry-forward<br/>min(unused, max_carry_forward_days)<br/>Cron 30 0 1 1 *"]
```

---

## 8. Data-scope visibility (who sees what)

```mermaid
flowchart TD
    R[req.auth.scope] --> S{scope}
    S -- SELF --> O[Own records only]
    S -- TEAM --> T[Direct reports +<br/>managed department]
    S -- DEPARTMENT --> D[Whole department]
    S -- ALL / tenant admin --> A[Entire tenant]
    O --> Q[Injected into SQL<br/>applyDataScope.js]
    T --> Q
    D --> Q
    A --> Q
```
