'use strict';

async function findByEmployee(pool, employeeId, { limit = 10, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT pr.id, pr.review_period, pr.review_type, pr.overall_rating,
            pr.work_quality, pr.productivity, pr.communication,
            pr.teamwork, pr.leadership, pr.status,
            pr.strengths, pr.areas_to_improve, pr.goals_next_period,
            pr.reviewer_comments, pr.employee_comments,
            TO_CHAR(pr.review_date, 'YYYY-MM-DD') AS review_date,
            TO_CHAR(pr.due_date,    'YYYY-MM-DD') AS due_date,
            r.full_name AS reviewer_name
     FROM performance_reviews pr
     LEFT JOIN employees r ON r.id = pr.reviewer_id AND r.deleted_at IS NULL
     WHERE pr.employee_id = $1
     ORDER BY pr.review_date DESC
     LIMIT $2 OFFSET $3`,
    [employeeId, limit, offset]
  );
  return rows;
}

async function getLatestRating(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT overall_rating, work_quality, productivity, communication,
            teamwork, leadership, review_period,
            TO_CHAR(review_date, 'YYYY-MM-DD') AS review_date
     FROM performance_reviews
     WHERE employee_id = $1 AND status = 'Completed'
     ORDER BY review_date DESC
     LIMIT 1`,
    [employeeId]
  );
  return rows[0] || null;
}

module.exports = { findByEmployee, getLatestRating };
