'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./notifications.service');

const list = asyncHandler(async (req, res) => {
  const data = await service.listNotifications(req.user);
  return ApiResponse.ok(res, data, 'Notifications retrieved successfully');
});

const markRead = asyncHandler(async (req, res) => {
  const data = await service.readNotification(req.user, req.params.id);
  return ApiResponse.ok(res, data, 'Notification marked as read');
});

const markAllRead = asyncHandler(async (req, res) => {
  await service.readAllNotifications(req.user);
  return ApiResponse.ok(res, null, 'All notifications marked as read');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteNotification(req.user, req.params.id);
  return ApiResponse.ok(res, null, 'Notification removed');
});

module.exports = {
  list,
  markRead,
  markAllRead,
  remove
};
