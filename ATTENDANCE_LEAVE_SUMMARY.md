# Attendance & Leave — One-Page Summary

_Plain-language overview for stakeholders. Technical detail in [ATTENDANCE_LEAVE_FLOW.md](ATTENDANCE_LEAVE_FLOW.md); diagrams in [ATTENDANCE_LEAVE_DIAGRAMS.md](ATTENDANCE_LEAVE_DIAGRAMS.md)._

## In one line
A multi-company (SaaS) HR system where each company's data is fully isolated, every screen is permission-controlled, and people only see the records their role allows.

---

## Attendance — what it does

- **Clock in / clock out.** Employees punch from the portal. The system records the time, marks them Present / Late / Half-Day based on the company's configured work hours, and calculates worked hours.
- **Company settings.** An Admin sets the daily working hours, grace period, and overtime rules from the Settings panel — these drive how attendance is judged.
- **Overtime.** If someone works beyond their hours, an approval request automatically goes to their **manager**. Once approved, the details are forwarded to the **concerned department** for processing. _(No one can approve their own overtime.)_
- **Monthly late/early report.** On the 1st of each month the system automatically emails each department a report of late arrivals and early exits for the previous month — no manual effort.
- **Corrections.** Employees can request a fix ("regularization") for a wrong/missing punch, which routes through the right approver.

## Leave — what it does

- **Set up leave types.** Admin creates leave types (e.g. Casual, Sick) and sets how many days each one allows, from Settings.
- **Apply for leave.** Employees apply from the portal. Each request follows a **two-step approval**:
  1. **Manager** approves first.
  2. **HR** gives the final approval.
- **Automatic balances.** The system tracks each person's remaining leave. Balance is deducted when leave is finally approved and restored if it's cancelled — automatically and without double-counting.
- **Year-end carry-forward.** Unused leave (up to the configured cap) rolls into the next year automatically.

---

## How access is controlled

| Who | Typically sees / can do |
|---|---|
| **Employee** | Their own attendance & leave; punch; apply for leave |
| **Manager** | Their team's records; approve stage-1 leave & overtime |
| **HR / Admin** | Company-wide; final leave approval; configure settings |

Permissions are enforced on the server (not just hidden in the UI), and each company's data is kept separate.

---

## Status snapshot (June 2026)

✅ **Working end-to-end:** clock in/out, working-hours config, overtime → manager → department, monthly auto-email, leave types & allocation, apply → manager → HR, automatic balances, carry-forward.

🔧 **Recently hardened:** closed a cross-company data-access risk on the settings screens; blocked self-approval of leave/overtime; made leave-balance updates safe under simultaneous use.

📋 **On the backlog (not blocking):** in-app screens to view the monthly report and trigger carry-forward manually; route the first leave notification to the specific manager; half-day leave support; expiry on carried-over days.
