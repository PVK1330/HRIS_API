'use strict';

const repo = require('./notifications.repository');
const { getTenantPool } = require('../../config/db');
const { runTenantMigrations } = require('../tenant/tenant.service');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch(() => null);
  _migrationCache.set(dbName, p);
  return p;
}

async function pushNotification(tenant, { employeeId, forAdmin, title, message, type }) {
  if (!tenant?.dbName) return null;
  await ensureMigrated(tenant.dbName);
  const pool = await getTenantPool(tenant.dbName);
  return repo.create(pool, { employeeId, forAdmin, title, message, type });
}

async function listNotifications(user) {
  if (!user?.db_name) return [];
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.listForUser(pool, user);
}

async function readNotification(user, id) {
  if (!user?.db_name) return null;
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.markAsRead(pool, id, user);
}

async function readAllNotifications(user) {
  if (!user?.db_name) return true;
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.markAllAsRead(pool, user);
}

async function deleteNotification(user, id) {
  if (!user?.db_name) return true;
  await ensureMigrated(user.db_name);
  const pool = await getTenantPool(user.db_name);
  return repo.remove(pool, id);
}

module.exports = {
  pushNotification,
  listNotifications,
  readNotification,
  readAllNotifications,
  deleteNotification
};
