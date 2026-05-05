'use strict';

const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
// ENCRYPTION_KEY should be 32 bytes for aes-256-gcm
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

if (KEY.length !== 32) {
  throw new Error('[encryption] ENCRYPTION_KEY must be a 32-byte (64-char) hex string');
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Returns a colon-delimited string: iv:authTag:ciphertext (all hex).
 */
function encrypt(text) {
  if (text === null || text === undefined) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a payload produced by encrypt().
 * Returns null if input is null/undefined.
 */
function decrypt(payload) {
  if (payload === null || payload === undefined) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format');
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
