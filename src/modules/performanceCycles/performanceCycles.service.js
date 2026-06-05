'use strict';

/**
 * ============================================================================
 * Performance Cycles Service
 * ============================================================================
 * Business logic layer for performance cycles:
 * - Validates cycle data
 * - Handles multi-tenant database pooling
 * - Orchestrates complex operations
 * - Provides clean interface for controllers
 * ============================================================================
 */

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const repo = require('./performanceCycles.repository');
const { runTenantMigrations } = require('../tenant/tenant.service');
const notify = require('../notifications/notifications.service');

function cycleLabel(cycle, data) {
  return cycle?.name || cycle?.cycle_name || data?.cycleName || data?.name || 'Performance cycle';
}

// Migration cache to avoid running migrations multiple times
const _migrationCache = new Map();

/**
 * Ensure tenant database is migrated before accessing it
 * @param {string} dbName - Tenant database name
 * @returns {Promise<void>}
 */
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) {
    return _migrationCache.get(dbName);
  }

  const migrationPromise = runTenantMigrations(dbName).catch((err) => {
    _migrationCache.delete(dbName);
    logger.error(`Migration failed for ${dbName}:`, err);
    throw ApiError.internal('Database setup failed.');
  });

  _migrationCache.set(dbName, migrationPromise);
  return migrationPromise;
}

/**
 * Get tenant database pool with validation
 * @param {Object} user - Authenticated user object
 * @returns {Pool} - Database pool connection
 * @throws {ApiError} - If tenant not found
 */
function getTenantDbPool(user) {
  if (!user?.db_name) {
    throw ApiError.unauthorized('Tenant not found');
  }
  return getTenantPool(user.db_name);
}

/**
 * Create a new performance cycle
 * @param {Object} user - Authenticated user
 * @param {Object} cycleData - Cycle data from request
 * @returns {Promise<Object>} - Created cycle
 * @throws {ApiError} - If validation fails or database error
 */
async function createCycle(user, cycleData) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    // Data will be validated by validator middleware before reaching here
    const cycle = await repo.create(pool, cycleData, user.id);

    notify.pushNotification({ db_name: user.db_name }, {
      forAdmin: true,
      title: `Performance Cycle Created: ${cycleLabel(cycle, cycleData)}`,
      message: `A new performance review cycle "${cycleLabel(cycle, cycleData)}" has been created.`,
      type: 'info',
      entityType: 'performance_cycle',
      entityId: cycle.id,
      redirectUrl: '/admin/performance',
    }).catch(() => null);

    logger.info(`Performance cycle created: ${cycle.id} by user ${user.id}`);
    return cycle;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error creating performance cycle:', error);
    throw ApiError.internal('Failed to create performance cycle');
  }
}

/**
 * Get all performance cycles with filters
 * @param {Object} user - Authenticated user
 * @param {Object} options - Query options
 * @param {string} options.search - Search term
 * @param {string} options.status - Filter by status
 * @param {number} options.page - Page number (1-based)
 * @param {number} options.limit - Records per page
 * @returns {Promise<Object>} - { cycles, total, page, totalPages }
 * @throws {ApiError} - If database error
 */
async function getAllCycles(user, options = {}) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    const {
      search = '',
      status = null,
      page = 1,
      limit = 10,
    } = options;

    const offset = (page - 1) * limit;

    const { cycles, total } = await repo.findAll(pool, {
      search,
      status,
      limit,
      offset,
    });

    const totalPages = Math.ceil(total / limit);

    logger.debug(`Retrieved ${cycles.length} performance cycles for tenant ${user.db_name}`);

    return {
      cycles,
      total,
      page,
      limit,
      totalPages,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error retrieving performance cycles:', error);
    throw ApiError.internal('Failed to retrieve performance cycles');
  }
}

/**
 * Get a single performance cycle by ID
 * @param {Object} user - Authenticated user
 * @param {number} id - Cycle ID
 * @returns {Promise<Object>} - Performance cycle data
 * @throws {ApiError} - If cycle not found or database error
 */
async function getCycleById(user, id) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    const cycle = await repo.findById(pool, id);

    if (!cycle) {
      throw ApiError.notFound('Performance cycle not found');
    }

    return cycle;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error retrieving performance cycle:', error);
    throw ApiError.internal('Failed to retrieve performance cycle');
  }
}

/**
 * Update a performance cycle
 * @param {Object} user - Authenticated user
 * @param {number} id - Cycle ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} - Updated cycle
 * @throws {ApiError} - If cycle not found or validation fails
 */
async function updateCycle(user, id, updateData) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    // Verify cycle exists
    const existingCycle = await repo.findById(pool, id);
    if (!existingCycle) {
      throw ApiError.notFound('Performance cycle not found');
    }

    const updatedCycle = await repo.update(pool, id, updateData, user.id);

    notify.pushNotification({ db_name: user.db_name }, {
      forAdmin: true,
      title: `Performance Cycle Updated: ${cycleLabel(updatedCycle, updateData)}`,
      message: `The performance review cycle "${cycleLabel(updatedCycle, existingCycle)}" has been updated.`,
      type: 'info',
      entityType: 'performance_cycle',
      entityId: id,
      redirectUrl: '/admin/performance',
    }).catch(() => null);

    logger.info(`Performance cycle ${id} updated by user ${user.id}`);
    return updatedCycle;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error updating performance cycle:', error);
    throw ApiError.internal('Failed to update performance cycle');
  }
}

/**
 * Delete a performance cycle (soft delete)
 * @param {Object} user - Authenticated user
 * @param {number} id - Cycle ID
 * @returns {Promise<Object>} - Deleted cycle data
 * @throws {ApiError} - If cycle not found
 */
async function deleteCycle(user, id) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    // Verify cycle exists
    const existingCycle = await repo.findById(pool, id);
    if (!existingCycle) {
      throw ApiError.notFound('Performance cycle not found');
    }

    const deletedCycle = await repo.softDelete(pool, id, user.id);

    notify.pushNotification({ db_name: user.db_name }, {
      forAdmin: true,
      title: `Performance Cycle Deleted: ${cycleLabel(existingCycle, null)}`,
      message: `The performance review cycle "${cycleLabel(existingCycle, null)}" has been deleted.`,
      type: 'warning',
      entityType: 'performance_cycle',
      entityId: id,
      redirectUrl: '/admin/performance',
    }).catch(() => null);

    logger.info(`Performance cycle ${id} deleted by user ${user.id}`);
    return deletedCycle;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error deleting performance cycle:', error);
    throw ApiError.internal('Failed to delete performance cycle');
  }
}

/**
 * Get performance cycles summary
 * @param {Object} user - Authenticated user
 * @returns {Promise<Object>} - { activeCycles, upcomingCycles, completedCycles }
 * @throws {ApiError} - If database error
 */
async function getCyclesSummary(user) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    const summary = await repo.getSummary(pool);

    logger.debug(`Retrieved performance cycles summary for tenant ${user.db_name}`);
    return summary;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error retrieving performance cycles summary:', error);
    throw ApiError.internal('Failed to retrieve performance cycles summary');
  }
}

/**
 * Refresh all cycle statuses (to be called by cron job)
 * @param {Object} user - Authenticated user
 * @returns {Promise<number>} - Number of updated cycles
 * @throws {ApiError} - If database error
 */
async function refreshCycleStatuses(user) {
  try {
    const pool = getTenantDbPool(user);
    await ensureMigrated(user.db_name);

    const updatedCount = await repo.refreshAllStatuses(pool);

    logger.info(`Refreshed statuses for ${updatedCount} performance cycles in tenant ${user.db_name}`);
    return updatedCount;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Error refreshing cycle statuses:', error);
    throw ApiError.internal('Failed to refresh cycle statuses');
  }
}

module.exports = {
  createCycle,
  getAllCycles,
  getCycleById,
  updateCycle,
  deleteCycle,
  getCyclesSummary,
  refreshCycleStatuses,
};
