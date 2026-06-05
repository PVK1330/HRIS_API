# Notification Logic — Report

Real-time notification system across HRIS (frontend) and HRIS_API (backend).

---

## 1. Architecture — how a notification travels
1. A user performs an operation (e.g. admin approves an expense, assigns an asset).
2. The module's **service** calls the notification service.
3. A row is **inserted** into the `notifications` table (persistent history + unread count).
4. Socket.io **emits** event `new_notification` to the recipient's room.
5. Recipient's 🔔 bell (`NotificationDropdown.jsx`) receives it **in real time**; it also polls every 30s as a fallback.
6. For key employee events, an **email** is also sent.

## 2. Recipient routing — which room gets the event
1. Employee target → `io.to('user:{employeeId}')` → that specific user.
2. Admin target → `io.to('tenant:{db}')` → all admins of the tenant.
3. Each socket joins its room on connect, using the `employeeId` from the JWT.

## 3. Two delivery channels
1. **In-app (always):** every notification emits `new_notification` + writes a DB row. No config needed.
2. **Email (selective):** only when `sendEmail: true` — used for important employee-facing events (money, documents, responsibilities). Requires SMTP config; admin emails require a tenant `admin_email`.

## 4. The two service functions used
1. `notify.sendSystemNotification(tenant, {...})` → in-app **+** email. Used for the affected **employee**.
2. `notify.pushNotification({ forAdmin: true, ... })` → in-app only. Used for **admin** broadcasts.

## 5. Standard payload — every notification carries
1. `title` + `message` — what the user sees.
2. `type` — `info` / `success` / `warning`.
3. `entityType` + `entityId` — what it's about.
4. `redirectUrl` — deep-link target when the bell item is clicked.
5. Recipient → either `employeeId` or `forAdmin: true`.

## 6. Reliability rules
1. Every notification call is **fire-and-forget** (`.catch(() => null)`) — a notification failure never breaks the core operation.
2. The operation completes (DB write) **first**; notification fires after.
3. For delete/return operations, the affected employee id is **fetched before** the row is removed.

## 7. Coverage by module (operation → recipient)

| Module | Operation → recipient | Email |
|---|---|---|
| **Assets** | assign / reassign → new & old holder; unassign / return, status change, delete → holder + admin | ✔ (assign/return) |
| **Expenses** | submit → admin; approve / reject / paid → employee; admin-delete → employee | ✔ (decisions) |
| **Payroll** | salary update → employee (in-app, no amounts); payroll item → admin | — |
| **Performance cycles** | create / update / delete → admin | — |
| **Letters** | dispatch → recipient employee | ✔ |
| **Visa records** | create / update / delete → the visa's employee | — |
| **Departments** | create / update / delete → admin; manager assigned → that manager | ✔ (manager) |
| **Designations** | create / update / delete → admin | — |
| **RBAC** | role create / delete + permission change → admin; permission change → every employee holding that role | — |

## 8. Pre-existing modules (already had notifications, unchanged)
1. Attendance, Leave, Exit management, Onboarding, Support tickets, Tasks, Announcements, Holidays, Policies.

## 9. Frontend behaviour
1. Listens for `new_notification` via the shared `useSocket()` hook → instant bell update.
2. Polls `GET /notifications` every 30s → guarantees eventual delivery if the socket drops.
3. Supports mark-read, mark-all-read, delete.

## 10. Open items to confirm
1. **`redirectUrl` paths** — currently sensible defaults; verify they match real frontend routes.
2. **RBAC fan-out** — a permission change notifies *every* holder of the role (a burst on large roles).
3. **Email** — only sends if SMTP is configured; in-app needs nothing.
