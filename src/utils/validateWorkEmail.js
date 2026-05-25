'use strict';

const validator = require('validator');

/** Accepts normal emails and dev hosts like user@tenant.localhost */
function isValidWorkEmail(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  if (!s) return true;
  if (/^[^\s@]+@[^\s@]+\.localhost$/i.test(s)) return true;
  if (/^[^\s@]+@localhost$/i.test(s)) return true;
  return validator.isEmail(s);
}

module.exports = { isValidWorkEmail };
