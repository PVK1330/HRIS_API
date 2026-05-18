"use strict";

const bcrypt = require("bcrypt");
const bcryptjs = require("bcryptjs");
const env = require("../config/env");

const ROUNDS = env.BCRYPT_SALT_ROUNDS || 12;

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), ROUNDS);
}

/**
 * Compare plain password to hash. Tries native bcrypt then bcryptjs so
 * passwords created with either library still work at login.
 */
async function comparePassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    if (await bcrypt.compare(String(plain), String(hash))) return true;
  } catch (_) {
    /* ignore */
  }
  try {
    if (await bcryptjs.compare(String(plain), String(hash))) return true;
  } catch (_) {
    /* ignore */
  }
  return false;
}

module.exports = {
  hashPassword,
  comparePassword,
  ROUNDS,
};
