'use strict';

const { Task, TaskComment, TaskAttachment } = require('./tasks.model');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const notificationService = require('../notifications/notifications.service');
const { runTenantMigrations } = require('../tenant/tenant.service');
const { getTenantPool } = require('../../config/db');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (!dbName) return;
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _migrationCache.delete(dbName);
    throw err;
  });
  _migrationCache.set(dbName, p);
  return p;
}

async function resolvePool(req) {
  const dbName = req.user?.db_name || req.tenant?.dbName || req.tenant?.db_name;
  if (!dbName) throw new ApiError(401, 'Tenant database not found');
  await ensureMigrated(dbName);
  return getTenantPool(dbName);
}

exports.getTasks = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const { status, assigneeId } = req.query;
    const tasks = await Task.findAll(pool, { status, assigneeId });
    return ApiResponse.ok(res, tasks, 'Tasks retrieved successfully');
  } catch (error) {
    next(error);
  }
};

exports.getTask = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const { id } = req.params;
    const task = await Task.findById(pool, id);
    if (!task) {
      throw new ApiError(404, 'Task not found');
    }
    const comments = await TaskComment.findByTaskId(pool, id);
    const attachments = await TaskAttachment.findByTaskId(pool, id);
    
    return ApiResponse.ok(res, { task, comments, attachments }, 'Task details retrieved successfully');
  } catch (error) {
    next(error);
  }
};

exports.createTask = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const assignerId = req.user.id;
    const task = await Task.create(pool, req.body, assignerId);
    
    if (task.assigneeId) {
      // Send Notification and Email to assignee
      await notificationService.sendSystemNotification(req.tenant, {
        employeeId: task.assigneeId,
        title: 'New Task Assigned',
        message: `You have been assigned a new task: ${task.title}`,
        type: 'task',
        entityType: 'task',
        entityId: task.id,
        redirectUrl: `/admin/tasks/${task.id}`,
        sendEmail: true
      });
    }

    return ApiResponse.created(res, task, 'Task created successfully');
  } catch (error) {
    next(error);
  }
};

exports.updateTask = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const { id } = req.params;
    const task = await Task.update(pool, id, req.body);
    if (!task) {
      throw new ApiError(404, 'Task not found');
    }
    
    return ApiResponse.ok(res, task, 'Task updated successfully');
  } catch (error) {
    next(error);
  }
};

exports.deleteTask = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const { id } = req.params;
    const task = await Task.delete(pool, id);
    if (!task) {
      throw new ApiError(404, 'Task not found');
    }
    return ApiResponse.ok(res, null, 'Task deleted successfully');
  } catch (error) {
    next(error);
  }
};

exports.addComment = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const { id } = req.params;
    const { comment } = req.body;
    const employeeId = req.user.id;

    if (!comment) {
      throw new ApiError(400, 'Comment is required');
    }

    const taskComment = await TaskComment.create(pool, id, employeeId, comment);
    return ApiResponse.created(res, taskComment, 'Comment added successfully');
  } catch (error) {
    next(error);
  }
};

exports.addAttachment = async (req, res, next) => {
  try {
    const pool = await resolvePool(req);
    const { id } = req.params;
    const uploaderId = req.user.id;
    const { file_name, file_url, file_type, file_size } = req.body;

    if (!file_url || !file_name) {
      throw new ApiError(400, 'File details are required');
    }

    const attachment = await TaskAttachment.create(pool, {
      taskId: id,
      uploaderId,
      fileName: file_name,
      fileUrl: file_url,
      fileType: file_type,
      fileSize: file_size
    });

    return ApiResponse.created(res, attachment, 'Attachment added successfully');
  } catch (error) {
    next(error);
  }
};
