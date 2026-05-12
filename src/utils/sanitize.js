"use strict";

/**
 * Strip angle-bracket HTML wrappers from free-text fields to reduce XSS when values are echoed in HTML.
 * Does not claim full HTML sanitization; pair with output escaping on the client.
 */
function sanitizePlainText(input) {
  if (input === undefined || input === null) return input;
  if (typeof input !== "string") return input;
  let s = input.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  return s.trim();
}

function sanitizeEmployeePayload(data) {
  if (!data || typeof data !== "object") return data;
  const stringKeys = [
    "fullName",
    "firstName",
    "lastName",
    "jobTitle",
    "department",
    "employmentType",
    "workLocation",
    "workMode",
    "workEmail",
    "personalEmail",
    "phoneNumber",
    "emergencyContactName",
    "emergencyContactPhone",
    "homeAddress",
    "nationality",
    "gender",
    "maritalStatus",
    "countryOfResidence",
    "bio",
    "grade",
    "passportNumber",
    "emiratesIdNumber",
    "visaType",
    "sponsoringEntity",
    "careerHistory",
    "awardsSummary",
    "promotionHistory",
    "username",
    "religion",
    "employmentSpouse",
    "bankName",
    "bankAccountNo",
    "ifscCode",
    "branchAddress",
    "reportingManagerEmpId",
    "empId",
    "costCenter",
  ];
  const out = { ...data };
  for (const k of stringKeys) {
    if (k in out && typeof out[k] === "string") out[k] = sanitizePlainText(out[k]);
  }
  return out;
}

module.exports = {
  sanitizePlainText,
  sanitizeEmployeePayload,
};
