'use strict';

const ApiError = require('../../utils/ApiError');

/**
 * Parse CSV file content into policy objects.
 * Expected columns: Title, Category, Description, Effective Date, Review Date,
 *                   Acknowledgement Required, Audience Type, Department IDs, Role IDs
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) {
    throw new ApiError(400, 'CSV must have a header row and at least one data row');
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());

  // Validate required columns
  const requiredColumns = ['title', 'category'];
  const missingColumns = requiredColumns.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    throw new ApiError(400, `Missing required columns: ${missingColumns.join(', ')}`);
  }

  const policies = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    try {
      const values = parseCSVLine(line);
      const row = {};

      headers.forEach((header, idx) => {
        row[header] = values[idx]?.trim() || '';
      });

      const policy = validateAndNormalizePolicyRow(row, i + 1);
      policies.push(policy);
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new ApiError(400, `CSV validation errors:\n${errors.join('\n')}`);
  }

  if (policies.length === 0) {
    throw new ApiError(400, 'No valid policies found in CSV');
  }

  return policies;
}

/**
 * Parse a single CSV line respecting quoted values.
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * Validate and normalize a policy row from import.
 */
function validateAndNormalizePolicyRow(row, lineNumber) {
  const title = row.title?.trim();
  const category = row.category?.trim();

  if (!title) {
    throw new Error('Title is required');
  }
  if (!category) {
    throw new Error('Category is required');
  }
  if (title.length > 255) {
    throw new Error('Title must be 255 characters or less');
  }
  if (category.length > 100) {
    throw new Error('Category must be 100 characters or less');
  }

  const effectiveDate = row.effective_date || row.effectivedate || '';
  if (effectiveDate && isNaN(new Date(effectiveDate).getTime())) {
    throw new Error('Invalid Effective Date format (use YYYY-MM-DD)');
  }

  const reviewDate = row.review_date || row.reviewdate || '';
  if (reviewDate && isNaN(new Date(reviewDate).getTime())) {
    throw new Error('Invalid Review Date format (use YYYY-MM-DD)');
  }

  const ackRequired = parseBoolean(row.acknowledgement_required || row.ackrequired, true);
  const audienceType = (row.audience_type || row.audiencetype || 'all').toLowerCase();

  if (!['all', 'departments', 'roles', 'new_joiners'].includes(audienceType)) {
    throw new Error('Audience Type must be: all, departments, roles, or new_joiners');
  }

  const departmentIds = parseCsvArray(row.department_ids || row.departmentids);
  const roleIds = parseCsvArray(row.role_ids || row.roleids);
  const newJoinersDays = parseInt(row.new_joiners_days || row.newjoinsdays || 90, 10);

  if (audienceType === 'departments' && departmentIds.length === 0) {
    throw new Error('Department IDs required when Audience Type is "departments"');
  }

  if (audienceType === 'roles' && roleIds.length === 0) {
    throw new Error('Role IDs required when Audience Type is "roles"');
  }

  return {
    title,
    category,
    description: row.description || '',
    effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
    reviewDate: reviewDate ? new Date(reviewDate) : null,
    ackRequired,
    status: 'Draft', // Imported policies start as draft
    audienceConfig: {
      type: audienceType,
      departmentIds,
      roleIds,
      newJoinersDays: Math.max(1, newJoinersDays),
    },
  };
}

/**
 * Parse boolean from CSV value (yes/no, true/false, 1/0).
 */
function parseBoolean(value, defaultValue = true) {
  if (!value) return defaultValue;
  const v = String(value).toLowerCase().trim();
  return ['yes', 'true', '1', 'y'].includes(v);
}

/**
 * Parse comma-separated IDs into number array.
 */
function parseCsvArray(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((n) => !isNaN(n));
}

/**
 * Validate bulk import payload (if JSON format).
 */
function validateJSONImport(policies) {
  if (!Array.isArray(policies)) {
    throw new ApiError(400, 'Import payload must be an array of policies');
  }

  if (policies.length === 0) {
    throw new ApiError(400, 'No policies provided');
  }

  if (policies.length > 100) {
    throw new ApiError(400, 'Maximum 100 policies can be imported at once');
  }

  const validatedPolicies = [];
  const errors = [];

  policies.forEach((policy, idx) => {
    try {
      const normalized = validateAndNormalizePolicyRow(policy, idx + 1);
      validatedPolicies.push(normalized);
    } catch (err) {
      errors.push(`Policy ${idx + 1}: ${err.message}`);
    }
  });

  if (errors.length > 0) {
    throw new ApiError(400, `Validation errors:\n${errors.join('\n')}`);
  }

  return validatedPolicies;
}

module.exports = {
  parseCSV,
  validateJSONImport,
  validateAndNormalizePolicyRow,
};
