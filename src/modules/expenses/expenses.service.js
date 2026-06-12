"use strict";

const { getTenantPool } = require("../../config/db");
const ApiError = require("../../utils/ApiError");
const notify = require("../notifications/notifications.service");

const STATUSES = new Set([
  "Draft",
  "Pending",
  "Approved",
  "Declined",
  "Rejected",
  "Paid",
  "Reimbursed",
  "Processed",
]);

// Allowed status transitions for the approval/payment endpoint (EXP-03).
// Source status -> set of statuses an approver may move the claim to.
// Submit / resubmit (Draft|Rejected -> Pending) happens via updateExpenseClaim,
// not here, so those are intentionally excluded from this map.
const STATUS_TRANSITIONS = {
  // EXP-05: 'Draft' added to Pending transitions so approvers can send a claim back.
  Pending: new Set(["Approved", "Rejected", "Declined", "Draft"]),
  Approved: new Set(["Paid", "Reimbursed", "Processed"]),
  Draft: new Set(),
  Rejected: new Set(),
  Declined: new Set(),
  Paid: new Set(),
  Reimbursed: new Set(),
  Processed: new Set(),
};

function assertValidStatusTransition(from, to) {
  if (from === to) return; // idempotent no-op
  const allowed = STATUS_TRANSITIONS[from] || new Set();
  if (!allowed.has(to)) {
    throw new ApiError(
      400,
      `Invalid status change: a "${from}" claim cannot be moved to "${to}".`,
    );
  }
}

// Block over-limit claims when they are submitted for approval (EXP-12).
// Drafts may be saved over a category's limit; only submission is blocked.
function assertWithinCategoryLimit(cat, amount) {
  const limit =
    cat?.limitAmount != null && cat.limitAmount !== ""
      ? parseFloat(cat.limitAmount)
      : null;
  if (
    limit != null &&
    !Number.isNaN(limit) &&
    limit > 0 &&
    parseFloat(amount) > limit
  ) {
    throw new ApiError(
      400,
      `Amount exceeds the "${cat.name}" category limit of ${limit}. Reduce the amount or save it as a draft.`,
    );
  }
}

// ── Multi-level approval engine (EXP-01 / EXP-02) ───────────────────────────

// Active levels that apply to a claim of the given amount, lowest level first.
async function getApplicableApprovalLevels(pool, amount) {
  const amt = parseFloat(amount) || 0;
  const { rows } = await pool.query(
    `SELECT level_no, name, min_amount, approver_permission
       FROM expense_approval_levels
      WHERE is_active = TRUE AND min_amount <= $1
      ORDER BY level_no ASC`,
    [amt],
  );
  return rows;
}

// (Re)build the pending approval chain for a claim from the active config.
// Returns the number of levels created (0 → falls back to single-step approval).
async function generateApprovalSteps(pool, expenseId, amount) {
  const levels = await getApplicableApprovalLevels(pool, amount);
  // Drop any prior un-actioned steps (e.g. on resubmission) before rebuilding.
  await pool.query(
    `DELETE FROM expense_approvals WHERE expense_id = $1 AND status = 'Pending'`,
    [expenseId],
  );
  for (const lvl of levels) {
    await pool.query(
      `INSERT INTO expense_approvals (expense_id, approver_id, level, status)
       VALUES ($1, NULL, $2, 'Pending')`,
      [expenseId, lvl.level_no],
    );
  }
  return levels.length;
}

async function getPendingSteps(pool, expenseId) {
  const { rows } = await pool.query(
    `SELECT id, level, status FROM expense_approvals
      WHERE expense_id = $1 AND status = 'Pending'
      ORDER BY level ASC, id ASC`,
    [expenseId],
  );
  return rows;
}

// Record a decision on the current (lowest) pending step.
// Returns { hadSteps, remaining } where remaining = pending steps left after an approval.
async function actionCurrentStep(
  pool,
  expenseId,
  { decision, approverId, comments },
) {
  const pending = await getPendingSteps(pool, expenseId);
  if (!pending.length) return { hadSteps: false, remaining: 0 };
  const current = pending[0];
  await pool.query(
    `UPDATE expense_approvals
        SET status = $1, approver_id = $2, comments = $3, actioned_at = NOW()
      WHERE id = $4`,
    [decision, approverId || null, comments || null, current.id],
  );
  const remaining = decision === "Approved" ? pending.length - 1 : 0;
  return { hadSteps: true, remaining, level: current.level };
}

// Full approval timeline for a claim (EXP-06).
async function getApprovalTimeline(pool, expenseId) {
  const { rows } = await pool.query(
    `SELECT ea.id, ea.level, ea.status, ea.comments, ea.actioned_at, ea.created_at,
            ea.approver_id,
            emp.full_name AS approver_name,
            lvl.name AS level_name
       FROM expense_approvals ea
       LEFT JOIN employees emp ON emp.id = ea.approver_id
       LEFT JOIN expense_approval_levels lvl ON lvl.level_no = ea.level
      WHERE ea.expense_id = $1
      ORDER BY ea.level ASC, ea.id ASC`,
    [expenseId],
  );
  return rows;
}

// Append an immutable entry to expense_audit_log (EXP-22).
// Non-fatal: a log failure must never break the main workflow.
async function logAudit(
  pool,
  expenseId,
  action,
  actorId,
  actorType,
  oldValue,
  newValue,
) {
  try {
    await pool.query(
      `INSERT INTO expense_audit_log
         (expense_id, action, actor_id, actor_type, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        expenseId,
        action,
        actorId || null,
        actorType || "system",
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      ],
    );
  } catch {
    // intentionally swallowed
  }
}

async function resolveExpenseCategory(pool, data) {
  const rawId = data.expenseCategoryId ?? data.categoryId;
  const nameFallback = String(
    data.expenseCategory || data.expense_category || "",
  ).trim();

  if (rawId != null && String(rawId).trim() !== "") {
    const idNum = parseInt(String(rawId), 10);
    if (Number.isNaN(idNum))
      throw new ApiError(400, "Invalid expense category id");
    const { rows } = await pool.query(
      `SELECT id, name, limit_amount, receipt_required FROM expense_categories WHERE id = $1 AND is_active = TRUE`,
      [idNum],
    );
    if (!rows[0])
      throw new ApiError(400, "Invalid or inactive expense category");
    return {
      id: rows[0].id,
      name: rows[0].name,
      limitAmount: rows[0].limit_amount,
      receiptRequired: rows[0].receipt_required,
    };
  }

  if (nameFallback) {
    const { rows } = await pool.query(
      `SELECT id, name, limit_amount, receipt_required FROM expense_categories
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND is_active = TRUE
       LIMIT 1`,
      [nameFallback],
    );
    if (rows[0])
      return {
        id: rows[0].id,
        name: rows[0].name,
        limitAmount: rows[0].limit_amount,
        receiptRequired: rows[0].receipt_required,
      };
    return {
      id: null,
      name: nameFallback,
      limitAmount: null,
      receiptRequired: false,
    };
  }

  throw new ApiError(400, "Expense category is required");
}

async function listExpenses(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  let whereClause = "WHERE ex.deleted_at IS NULL";
  const params = [];

  const employeeIdFilter = (query.employeeId || query.employee_id || "")
    .toString()
    .trim();
  if (employeeIdFilter) {
    whereClause += ` AND ex.employee_id = $${params.length + 1}`;
    params.push(parseInt(employeeIdFilter, 10));
  }

  const categoryIdFilter = (query.expenseCategoryId || query.categoryId || "")
    .toString()
    .trim();
  if (categoryIdFilter && !Number.isNaN(parseInt(categoryIdFilter, 10))) {
    whereClause += ` AND ex.expense_category_id = $${params.length + 1}`;
    params.push(parseInt(categoryIdFilter, 10));
  }

  const search = (query.search || "").trim();
  if (search) {
    whereClause += ` AND (COALESCE(ex.employee_name, emp.full_name) ILIKE $${params.length + 1})`;
    params.push(`%${search}%`);
  }

  // Filter by category or status (dual-use expenseType query param)
  const expenseType = (query.expenseType || "").trim();
  if (expenseType && expenseType !== "All") {
    if (STATUSES.has(expenseType)) {
      if (expenseType === "Declined" || expenseType === "Rejected") {
        whereClause += ` AND ex.status IN ($${params.length + 1}, $${params.length + 2})`;
        params.push("Declined", "Rejected");
      } else if (expenseType === "Paid" || expenseType === "Reimbursed") {
        whereClause += ` AND ex.status IN ($${params.length + 1}, $${params.length + 2})`;
        params.push("Paid", "Reimbursed");
      } else {
        whereClause += ` AND ex.status = $${params.length + 1}`;
        params.push(expenseType);
      }
    } else {
      whereClause += ` AND ex.expense_category = $${params.length + 1}`;
      params.push(expenseType);
    }
  }

  // Get total count
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, params);
  const total = countResult.rows[0]?.total ?? 0;

  // Get records
  const dataQuery = `
    SELECT 
      ex.id,
      ex.employee_id,
      COALESCE(ex.employee_name, emp.full_name) AS employee_name,
      COALESCE(emp.department, 'Operations') AS department,
      ex.expense_category,
      ex.expense_category_id,
      ex.expense_title AS claim_title,
      ex.amount,
      ex.currency,
      TO_CHAR(ex.expense_date, 'YYYY-MM-DD') AS expense_date,
      ex.payment_method,
      ex.project_department,
      ex.project_client,
      ex.description,
      ex.receipt_url,
      ex.status,
      ex.created_at,
      ex.vendor
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    ${whereClause}
    ORDER BY ex.created_at DESC, ex.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(dataQuery, dataParams);

  return {
    data: rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function getExpense(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const query = `
    SELECT 
      ex.*,
      ex.expense_title AS claim_title,
      COALESCE(ex.employee_name, emp.full_name) AS employee_name,
      COALESCE(emp.department, 'Operations') AS department
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    WHERE ex.id = $1 AND ex.deleted_at IS NULL
  `;

  const { rows } = await pool.query(query, [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "Expense claim not found");
  // Attach the approval timeline so claim detail can render it (EXP-06).
  row.approvals = await getApprovalTimeline(pool, row.id);
  return row;
}

async function createExpense(tenant, data, receiptFile) {
  const pool = await getTenantPool(tenant.dbName);
  const {
    employeeId,
    employeeName,
    claimTitle,
    expenseDate,
    amount,
    currency,
    paymentMethod,
    vendor,
    description,
    projectClient,
  } = data;

  if (!employeeId || !claimTitle || !expenseDate || !amount) {
    throw new ApiError(400, "Missing required fields");
  }

  let cat;
  cat = await resolveExpenseCategory(pool, data);

  const isDraft = data.isDraft === true || data.isDraft === "true";
  const numericAmount = parseFloat(amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const vatAmount = data.vatAmount != null ? parseFloat(data.vatAmount) : null;
  const status = isDraft ? "Draft" : "Pending";

  // Enforce category policies only when submitting (not on Draft save).
  if (status === "Pending") {
    assertWithinCategoryLimit(cat, numericAmount);
    // EXP-13: block submission when category requires a receipt but none was attached.
    if (cat.receiptRequired && !receiptFile) {
      throw new ApiError(
        400,
        `A receipt is required for the "${cat.name}" category.`,
      );
    }
  }

  const receiptUrl = receiptFile
    ? receiptFile.location || `/uploads/receipts/${receiptFile.filename}`
    : null;

  const query = `
    INSERT INTO expenses (
      employee_id, employee_name, expense_title,
      expense_category, expense_category_id,
      expense_date, amount, vat_amount, currency,
      payment_method, vendor, description,
      project_client, project_department, receipt_url, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *;
  `;

  const values = [
    parseInt(employeeId, 10),
    employeeName || null,
    claimTitle,
    cat.name,
    cat.id,
    expenseDate,
    numericAmount,
    Number.isNaN(vatAmount) ? null : vatAmount,
    currency || "AED",
    paymentMethod || null,
    vendor || null,
    description || null,
    projectClient || null,
    projectClient || null,
    receiptUrl,
    status,
  ];

  const { rows } = await pool.query(query, values);

  await logAudit(
    pool,
    rows[0].id,
    "created",
    parseInt(employeeId, 10),
    "employee",
    null,
    { status: rows[0].status, amount: rows[0].amount },
  );

  // Submitted (non-draft) claim → build its approval chain (EXP-01) and alert admins.
  if (status === "Pending") {
    await generateApprovalSteps(pool, rows[0].id, numericAmount);
  }

  const created = await getExpense(tenant, rows[0].id);

  if (created.status === "Pending") {
    notify
      .pushNotification(tenant, {
        forAdmin: true,
        title: `New Expense Claim: ${created.expense_title}`,
        message: `${created.employee_name || "An employee"} submitted an expense claim of ${created.currency || "INR"} ${created.amount} for "${created.expense_title}".`,
        type: "info",
        entityType: "expense",
        entityId: created.id,
        redirectUrl: "/admin/expenses",
      })
      .catch(() => null);
  }

  return created;
}

async function updateExpenseClaim(tenant, id, data, user, receiptFile) {
  const pool = await getTenantPool(tenant.dbName);
  const existing = await getExpense(tenant, id);
  const role = user?.role;
  const empId = user?.employeeId;

  const employeeOwned =
    empId != null &&
    parseInt(String(existing.employee_id), 10) === parseInt(String(empId), 10);

  const st = String(existing.status);
  const editableStatus = ["Draft", "Rejected", "Declined"].includes(st);

  const canEdit =
    (role === "admin" && editableStatus) ||
    (role === "employee" && employeeOwned && editableStatus);

  if (!canEdit) {
    throw new ApiError(403, "You cannot edit this expense claim");
  }

  const submitNow = data.submitNow === true || data.submitNow === "true";
  const keepDraft = data.isDraft === true || data.isDraft === "true";

  let nextStatus = String(existing.status);
  if (submitNow && ["Draft", "Rejected", "Declined"].includes(nextStatus)) {
    nextStatus = "Pending";
  } else if (keepDraft) {
    nextStatus = "Draft";
  }

  const claimTitle =
    data.claimTitle ?? data.claim_title ?? existing.expense_title;
  let expenseCategoryName = existing.expense_category;
  let expenseCategoryId = existing.expense_category_id;
  let categoryLimit = null;

  const hasCatUpdate =
    (data.expenseCategoryId != null &&
      String(data.expenseCategoryId).trim() !== "") ||
    (data.categoryId != null && String(data.categoryId).trim() !== "") ||
    (data.expenseCategory != null &&
      String(data.expenseCategory).trim() !== "") ||
    (data.expense_category != null &&
      String(data.expense_category).trim() !== "");

  if (hasCatUpdate) {
    const cat = await resolveExpenseCategory(pool, {
      expenseCategoryId: data.expenseCategoryId ?? data.categoryId,
      expenseCategory: data.expenseCategory ?? data.expense_category,
    });
    expenseCategoryName = cat.name;
    expenseCategoryId = cat.id;
    categoryLimit = cat.limitAmount;
  }

  const expenseDateRaw =
    data.expenseDate ?? data.expense_date ?? existing.expense_date;
  const expenseDate =
    expenseDateRaw instanceof Date
      ? expenseDateRaw.toISOString().slice(0, 10)
      : String(expenseDateRaw).slice(0, 10);
  const amountVal =
    data.amount != null
      ? parseFloat(String(data.amount))
      : parseFloat(String(existing.amount));
  const currency = data.currency ?? existing.currency;
  const paymentMethod =
    data.paymentMethod ?? data.payment_method ?? existing.payment_method;
  const description = data.description ?? existing.description;

  if (
    !claimTitle ||
    !expenseCategoryName ||
    !expenseDate ||
    Number.isNaN(amountVal) ||
    amountVal <= 0
  ) {
    throw new ApiError(400, "Missing or invalid required fields");
  }

  // Enforce the category spend limit when (re)submitting for approval (EXP-12).
  if (nextStatus === "Pending") {
    if (categoryLimit == null && expenseCategoryId != null) {
      const { rows: catRows } = await pool.query(
        `SELECT limit_amount FROM expense_categories WHERE id = $1`,
        [expenseCategoryId],
      );
      categoryLimit = catRows[0]?.limit_amount ?? null;
    }
    assertWithinCategoryLimit(
      { name: expenseCategoryName, limitAmount: categoryLimit },
      amountVal,
    );
  }

  // Preserve existing vendor/project_client if not provided in update.
  const vendor =
    data.vendor !== undefined ? data.vendor || null : existing.vendor || null;
  const projectClient =
    (data.projectClient ?? data.project_client) !== undefined
      ? (data.projectClient ?? data.project_client) || null
      : existing.project_client || null;

  // EXP-13: receipt-required check on (re)submission.
  if (nextStatus === "Pending") {
    const hasExistingReceipt = !!existing.receipt_url;
    if (!receiptFile && !hasExistingReceipt) {
      const { rows: catRows } = await pool.query(
        `SELECT receipt_required FROM expense_categories WHERE id = $1`,
        [expenseCategoryId],
      );
      if (catRows[0]?.receipt_required) {
        throw new ApiError(
          400,
          `A receipt is required for the "${expenseCategoryName}" category.`,
        );
      }
    }
  }

  const newReceiptUrl = receiptFile
    ? receiptFile.location || `/uploads/receipts/${receiptFile.filename}`
    : null;
  const receiptSql = newReceiptUrl ? `, receipt_url = $13` : "";
  const updateParams = [
    claimTitle,
    expenseCategoryName,
    expenseCategoryId,
    expenseDate,
    amountVal,
    currency || "AED",
    paymentMethod || null,
    description || null,
    nextStatus,
    vendor,
    projectClient,
    id,
  ];
  if (newReceiptUrl) updateParams.push(newReceiptUrl);

  await pool.query(
    `UPDATE expenses SET
       expense_title = $1,
       expense_category = $2,
       expense_category_id = $3,
       expense_date = $4,
       amount = $5,
       currency = $6,
       payment_method = $7,
       description = $8,
       status = $9,
       vendor = $10,
       project_client = $11,
       updated_at = NOW()
       ${receiptSql}
     WHERE id = $12`,
    updateParams,
  );

  // Re-submitted for approval → (re)build the approval chain (EXP-01).
  if (nextStatus === "Pending" && String(existing.status) !== "Pending") {
    await generateApprovalSteps(pool, id, amountVal);
  }

  const result = await getExpense(tenant, id);

  await logAudit(
    pool,
    parseInt(id, 10),
    "updated",
    user?.id || null,
    user?.role || "system",
    { status: existing.status, amount: existing.amount },
    { status: result.status, amount: result.amount },
  );

  // Draft/Rejected claim re-submitted for approval → alert admins.
  if (nextStatus === "Pending" && String(existing.status) !== "Pending") {
    notify
      .pushNotification(tenant, {
        forAdmin: true,
        title: `Expense Claim Submitted: ${result.expense_title}`,
        message: `${result.employee_name || "An employee"} submitted an expense claim of ${result.currency || "INR"} ${result.amount} for approval.`,
        type: "info",
        entityType: "expense",
        entityId: id,
        redirectUrl: "/admin/expenses",
      })
      .catch(() => null);
  }

  return result;
}

async function updateExpenseStatus(tenant, id, payload, userId) {
  const pool = await getTenantPool(tenant.dbName);
  const status = payload.status;
  // Reject unknown status strings so the catch-all UPDATE branch below cannot
  // persist an arbitrary status and corrupt the approval/payment workflow.
  if (!status || !STATUSES.has(status)) {
    throw new ApiError(400, `Invalid expense status: ${status}`);
  }

  // Enforce the approval/payment state machine (EXP-03): only valid transitions
  // from the claim's current status are allowed (e.g. Draft->Paid is rejected).
  const current = await getExpense(tenant, id);
  assertValidStatusTransition(String(current.status), status);

  const rejectionReason = payload.rejectionReason ?? payload.rejection_reason;
  const approver = userId || null;
  const isReject = status === "Rejected" || status === "Declined";
  const isApprove = status === "Approved";
  const isPaid =
    status === "Paid" || status === "Reimbursed" || status === "Processed";
  // EXP-05: send-back returns claim to Draft so the employee can correct and resubmit.
  const isSendBack = status === "Draft" && String(current.status) === "Pending";
  const paymentReference =
    payload.paymentReference ?? payload.payment_reference ?? null;
  const paymentDate = payload.paymentDate ?? payload.payment_date ?? null;

  // ── Multi-level approval advancement (EXP-01) ──────────────────────────────
  // Approving a claim that has a pending approval chain signs off the current
  // level. The claim only becomes Approved once the final level is cleared;
  // claims with no configured steps fall back to the legacy single-step flip.
  if (isApprove) {
    const step = await actionCurrentStep(pool, id, {
      decision: "Approved",
      approverId: approver,
      comments: payload.comments ?? payload.comment ?? null,
    });
    if (step.hadSteps && step.remaining > 0) {
      await pool.query(`UPDATE expenses SET updated_at = NOW() WHERE id = $1`, [
        id,
      ]);
      const partial = await getExpense(tenant, id);
      notify
        .pushNotification(tenant, {
          forAdmin: true,
          title: `Expense Awaiting Next Approval: ${partial.expense_title}`,
          message: `Level ${step.level} approved — ${step.remaining} more approval level(s) required for "${partial.expense_title}".`,
          type: "info",
          entityType: "expense",
          entityId: id,
          redirectUrl: "/admin/expenses",
        })
        .catch(() => null);
      return partial;
    }
    // Final level (or no configured chain) → fall through to mark Approved.
  } else if (isReject) {
    await actionCurrentStep(pool, id, {
      decision: "Rejected",
      approverId: approver,
      comments: rejectionReason || null,
    });
  } else if (isSendBack) {
    // EXP-05: record the send-back on the current pending step then drop claim to Draft.
    await actionCurrentStep(pool, id, {
      decision: "Rejected",
      approverId: approver,
      comments:
        rejectionReason || payload.comments || "Sent back for correction",
    });
  }

  let query;
  let values;
  if (isReject) {
    query = `
      UPDATE expenses
      SET status=$1, rejection_reason=$2, approved_by=$3, approved_at=NOW(), updated_at=NOW()
      WHERE id=$4 RETURNING *;
    `;
    values = [status, rejectionReason || null, approver, id];
  } else if (isSendBack) {
    // EXP-05: return to Draft with an optional comment stored as rejection_reason so the UI can show it.
    query = `
      UPDATE expenses
      SET status='Draft', rejection_reason=$1, approved_by=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *;
    `;
    values = [
      rejectionReason || payload.comments || "Sent back for correction",
      approver,
      id,
    ];
  } else if (isApprove) {
    query = `
      UPDATE expenses
      SET status=$1, approved_by=$2, approved_at=NOW(), rejection_reason=NULL, updated_at=NOW()
      WHERE id=$3 RETURNING *;
    `;
    values = [status, approver, id];
  } else if (isPaid) {
    // EXP-19: capture payment reference and date when marking paid.
    query = `
      UPDATE expenses
      SET status=$1, reimbursed_at=COALESCE(reimbursed_at,NOW()),
          payment_reference=$2, payment_date=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *;
    `;
    values = [status, paymentReference, paymentDate || null, id];
  } else {
    query = `
      UPDATE expenses SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *;
    `;
    values = [status, id];
  }

  const { rows } = await pool.query(query, values);
  if (!rows.length) throw new ApiError(404, "Expense claim not found");
  const result = await getExpense(tenant, id);

  await logAudit(
    pool,
    parseInt(id, 10),
    "status_changed",
    userId || null,
    "admin",
    { status: String(current.status) },
    { status },
  );

  // Notify the claim owner of the decision (approval / rejection / payment).
  const empId = result.employee_id ? Number(result.employee_id) : null;
  if (empId) {
    const amountLabel = `${result.currency || "INR"} ${result.amount}`;
    if (isApprove) {
      notify
        .sendSystemNotification(tenant, {
          employeeId: empId,
          title: `Expense Approved: ${result.expense_title}`,
          message: `Your expense claim of ${amountLabel} for "${result.expense_title}" has been approved.`,
          type: "success",
          entityType: "expense",
          entityId: id,
          redirectUrl: "/employee/expenses",
          sendEmail: true,
        })
        .catch(() => null);
    } else if (isReject) {
      notify
        .sendSystemNotification(tenant, {
          employeeId: empId,
          title: `Expense Rejected: ${result.expense_title}`,
          message: `Your expense claim of ${amountLabel} for "${result.expense_title}" was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
          type: "warning",
          entityType: "expense",
          entityId: id,
          redirectUrl: "/employee/expenses",
          sendEmail: true,
        })
        .catch(() => null);
    } else if (isSendBack) {
      // EXP-05: notify employee that their claim was sent back for correction.
      notify
        .sendSystemNotification(tenant, {
          employeeId: empId,
          title: `Expense Sent Back: ${result.expense_title}`,
          message: `Your expense claim of ${amountLabel} for "${result.expense_title}" was sent back for correction.${rejectionReason ? ` Comment: ${rejectionReason}` : ""}`,
          type: "warning",
          entityType: "expense",
          entityId: id,
          redirectUrl: "/employee/expenses",
          sendEmail: true,
        })
        .catch(() => null);
    } else if (isPaid) {
      notify
        .sendSystemNotification(tenant, {
          employeeId: empId,
          title: `Expense Reimbursed: ${result.expense_title}`,
          message: `Your expense claim of ${amountLabel} for "${result.expense_title}" has been marked as ${status}.${paymentReference ? ` Reference: ${paymentReference}` : ""}`,
          type: "success",
          entityType: "expense",
          entityId: id,
          redirectUrl: "/employee/expenses",
          sendEmail: true,
        })
        .catch(() => null);
    }
  }

  return result;
}

async function deleteExpense(tenant, id, user) {
  const pool = await getTenantPool(tenant.dbName);
  if (user?.role === "employee" && user?.employeeId) {
    const row = await getExpense(tenant, id);
    if (
      parseInt(String(row.employee_id), 10) !==
      parseInt(String(user.employeeId), 10)
    ) {
      throw new ApiError(403, "You cannot delete this expense claim");
    }
    if (String(row.status) !== "Draft") {
      throw new ApiError(400, "Only draft claims can be deleted");
    }
  }

  const { rows } = await pool.query(
    `UPDATE expenses
        SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *`,
    [id],
  );
  if (!rows.length) throw new ApiError(404, "Expense claim not found");
  const deleted = rows[0];

  await logAudit(
    pool,
    parseInt(id, 10),
    "deleted",
    user?.id || null,
    user?.role || "system",
    { status: deleted.status, expense_title: deleted.expense_title },
    null,
  );

  // An admin removed someone's claim → let the owner know.
  if (deleted?.employee_id && user?.role !== "employee") {
    notify
      .sendSystemNotification(tenant, {
        employeeId: Number(deleted.employee_id),
        title: `Expense Claim Removed: ${deleted.expense_title}`,
        message: `Your expense claim "${deleted.expense_title}" (${deleted.currency || "INR"} ${deleted.amount}) was removed by an administrator.`,
        type: "warning",
        entityType: "expense",
        entityId: id,
        redirectUrl: "/employee/expenses",
        sendEmail: false,
      })
      .catch(() => null);
  }

  return deleted;
}

async function getExpensesStats(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  let whereClause = "WHERE deleted_at IS NULL";
  const params = [];

  const employeeId = query.employeeId || query.employee_id;
  if (employeeId) {
    whereClause += ` AND employee_id = $${params.length + 1}`;
    params.push(parseInt(employeeId, 10));
  }

  const statsQuery = `
    SELECT
      COALESCE(COUNT(*), 0)::int as total,
      COALESCE(COUNT(CASE WHEN status = 'Draft' THEN 1 END), 0)::int as drafts,
      COALESCE(COUNT(CASE WHEN status = 'Pending' THEN 1 END), 0)::int as pending,
      COALESCE(COUNT(CASE WHEN status = 'Approved' THEN 1 END), 0)::int as approved,
      COALESCE(COUNT(CASE WHEN status = 'Declined' OR status = 'Rejected' THEN 1 END), 0)::int as declined,
      COALESCE(COUNT(CASE WHEN status = 'Paid' OR status = 'Reimbursed' THEN 1 END), 0)::int as paid,
      COALESCE(SUM(amount), 0)::numeric as total_amount,
      COALESCE(SUM(CASE WHEN status = 'Pending' THEN amount END), 0)::numeric as pending_amount,
      COALESCE(SUM(CASE WHEN status = 'Approved' THEN amount END), 0)::numeric as approved_amount,
      COALESCE(SUM(CASE WHEN status = 'Paid' OR status = 'Reimbursed' OR status = 'Processed' THEN amount END), 0)::numeric as paid_amount
    FROM expenses
    ${whereClause}
  `;

  const { rows } = await pool.query(statsQuery, params);
  const row = rows[0];

  // NOTE: amounts are summed in the claim's stored currency. Cross-currency
  // normalization to a tenant base currency is tracked separately (EXP-08).
  const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

  return {
    total: row.total,
    drafts: row.drafts,
    pending: row.pending,
    approved: row.approved,
    declined: row.declined,
    paid: row.paid,
    totalClaims: row.total,
    draftClaims: row.drafts,
    pendingClaims: row.pending,
    approvedClaims: row.approved,
    rejectedClaims: row.declined,
    // Spend aggregates (EXP-07)
    totalAmount: num(row.total_amount),
    pendingAmount: num(row.pending_amount),
    approvedAmount: num(row.approved_amount),
    paidAmount: num(row.paid_amount),
  };
}

// ── Approval level config (EXP-02) ──────────────────────────────────────────
async function listApprovalLevels(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, level_no, name, min_amount, approver_permission, is_active, created_at, updated_at
       FROM expense_approval_levels
      ORDER BY level_no ASC`,
  );
  return rows;
}

// Replace the whole approval-level set in one transaction (admin config save).
async function replaceApprovalLevels(tenant, levels) {
  if (!Array.isArray(levels))
    throw new ApiError(400, "levels must be an array");

  const seen = new Set();
  const cleaned = levels.map((l, i) => {
    const levelNo = parseInt(l.levelNo ?? l.level_no, 10);
    const name = String(l.name || "").trim();
    const minRaw = l.minAmount ?? l.min_amount ?? 0;
    const minAmount = parseFloat(minRaw);
    if (!Number.isInteger(levelNo) || levelNo < 1) {
      throw new ApiError(400, `Invalid level number at position ${i + 1}`);
    }
    if (!name)
      throw new ApiError(400, `Level name is required at position ${i + 1}`);
    if (seen.has(levelNo))
      throw new ApiError(400, `Duplicate level number ${levelNo}`);
    seen.add(levelNo);
    return {
      levelNo,
      name,
      minAmount: Number.isNaN(minAmount) ? 0 : minAmount,
      isActive: l.isActive ?? l.is_active ?? true,
    };
  });

  const pool = await getTenantPool(tenant.dbName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM expense_approval_levels");
    for (const l of cleaned) {
      await client.query(
        `INSERT INTO expense_approval_levels (level_no, name, min_amount, is_active)
         VALUES ($1, $2, $3, $4)`,
        [l.levelNo, l.name, l.minAmount, Boolean(l.isActive)],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return listApprovalLevels(tenant);
}

// ── Excel export (EXP-10) ────────────────────────────────────────────────────
async function exportExpenses(tenant, query) {
  const result = await listExpenses(tenant, {
    ...(query || {}),
    limit: 5000,
    page: 1,
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HRIS";
  const sheet = workbook.addWorksheet("Expenses");

  sheet.columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee", key: "employee_name", width: 25 },
    { header: "Title", key: "claim_title", width: 35 },
    { header: "Category", key: "expense_category", width: 20 },
    { header: "Department", key: "department", width: 18 },
    { header: "Date", key: "expense_date", width: 14 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "VAT", key: "vat_amount", width: 10 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Payment Method", key: "payment_method", width: 18 },
    { header: "Vendor", key: "vendor", width: 22 },
    { header: "Status", key: "status", width: 14 },
    { header: "Payment Ref", key: "payment_reference", width: 22 },
    { header: "Submitted At", key: "created_at", width: 22 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F766E" },
  };
  headerRow.height = 18;

  for (const r of result.data) {
    sheet.addRow({
      id: r.id,
      employee_name: r.employee_name || "",
      claim_title: r.claim_title || "",
      expense_category: r.expense_category || "",
      department: r.department || "",
      expense_date: r.expense_date || "",
      amount: parseFloat(r.amount) || 0,
      vat_amount: r.vat_amount != null ? parseFloat(r.vat_amount) : "",
      currency: r.currency || "AED",
      payment_method: r.payment_method || "",
      vendor: r.vendor || "",
      status: r.status || "",
      payment_reference: r.payment_reference || "",
      created_at: r.created_at ? new Date(r.created_at).toLocaleString() : "",
    });
  }

  return workbook;
}

// ── Excel bulk import (EXP-30) ───────────────────────────────────────────────
function normaliseHeader(h) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, "");
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const n = Number(val);
  if (!Number.isNaN(n) && n > 1000) {
    return new Date(Math.round((n - 25569) * 86400 * 1000))
      .toISOString()
      .slice(0, 10);
  }
  const str = String(val).trim();
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function importExpenses(tenant, fileBuffer, actorId) {
  const pool = await getTenantPool(tenant.dbName);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ApiError(400, "Excel file has no worksheets");

  const colMap = {};
  sheet.getRow(1).eachCell((cell, colIdx) => {
    colMap[normaliseHeader(cell.value)] = colIdx;
  });
  const cellVal = (row, ...keys) => {
    for (const k of keys) {
      const idx = colMap[normaliseHeader(k)];
      if (idx) {
        const v = row.getCell(idx).value;
        if (v != null) return v;
      }
    }
    return null;
  };

  const imported = [];
  const errors = [];

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    let hasData = false;
    row.eachCell(() => {
      hasData = true;
    });
    if (!hasData) continue;

    const employeeId = parseInt(
      String(cellVal(row, "Employee ID", "employeeid") ?? ""),
      10,
    );
    const claimTitle = String(cellVal(row, "Title", "title") ?? "").trim();
    const categoryRaw = cellVal(row, "Category", "category");
    const expenseDate = parseDate(cellVal(row, "Date", "Expense Date", "date"));
    const amount = parseFloat(String(cellVal(row, "Amount", "amount") ?? ""));
    const currency =
      String(cellVal(row, "Currency", "currency") ?? "AED").toUpperCase() ||
      "AED";
    const paymentMethod =
      String(cellVal(row, "Payment Method", "paymentmethod") ?? "").trim() ||
      null;
    const description =
      String(cellVal(row, "Description", "description") ?? "").trim() || null;
    const vendor =
      String(cellVal(row, "Vendor", "vendor") ?? "").trim() || null;

    const rowErrors = [];
    if (Number.isNaN(employeeId)) rowErrors.push("Employee ID required");
    if (!claimTitle) rowErrors.push("Title required");
    if (!categoryRaw) rowErrors.push("Category required");
    if (!expenseDate) rowErrors.push("Date required or invalid");
    if (Number.isNaN(amount) || amount <= 0)
      rowErrors.push("Amount must be positive");

    if (rowErrors.length) {
      errors.push({ row: rowNum, reasons: rowErrors });
      continue;
    }

    let cat;
    try {
      cat = await resolveExpenseCategory(pool, {
        expenseCategory: String(categoryRaw).trim(),
      });
    } catch {
      errors.push({
        row: rowNum,
        reasons: [`Category "${categoryRaw}" not found`],
      });
      continue;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO expenses
           (employee_id, expense_title, expense_category, expense_category_id,
            expense_date, amount, currency, payment_method, description, vendor, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Draft') RETURNING id, amount, status`,
        [
          employeeId,
          claimTitle,
          cat.name,
          cat.id,
          expenseDate,
          amount,
          currency,
          paymentMethod,
          description,
          vendor,
        ],
      );
      await logAudit(
        pool,
        rows[0].id,
        "created",
        actorId || null,
        "import",
        null,
        { status: "Draft", amount: rows[0].amount, source: "excel_import" },
      );
      imported.push(rows[0].id);
    } catch (e) {
      errors.push({ row: rowNum, reasons: [e.message || "Insert failed"] });
    }
  }

  return { imported: imported.length, skipped: errors.length, errors };
}

async function generateImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HRIS";
  const sheet = workbook.addWorksheet("Expenses");

  sheet.columns = [
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Title", key: "title", width: 30 },
    { header: "Category", key: "category", width: 20 },
    { header: "Date", key: "date", width: 14 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Payment Method", key: "payment_method", width: 18 },
    { header: "Description", key: "description", width: 35 },
    { header: "Vendor", key: "vendor", width: 22 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F766E" },
  };
  headerRow.height = 20;

  sheet.addRow({
    employee_id: 1,
    title: "Client meeting transport",
    category: "Travel",
    date: "2026-06-01",
    amount: 250,
    currency: "AED",
    payment_method: "Cash",
    description: "Taxi to client office",
    vendor: "Careem",
  });

  return workbook;
}

module.exports = {
  listExpenses,
  getExpense,
  createExpense,
  updateExpenseClaim,
  updateExpenseStatus,
  deleteExpense,
  getExpensesStats,
  listApprovalLevels,
  replaceApprovalLevels,
  exportExpenses,
  importExpenses,
  generateImportTemplate,
};
