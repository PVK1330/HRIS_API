'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./notifications.service');

const list = asyncHandler(async (req, res) => {
  

  const data = await service.listNotifications(req.user, req.tenant);
  
  

  return ApiResponse.ok(res, data, 'Notifications retrieved successfully');
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await service.countUnread(req.user, req.tenant);
  // `count` is mirrored at the top level so clients reading response.data.count
  // (NotificationDropdown) and response.data.data.count both work.
  return ApiResponse.ok(res, { count }, 'Unread count retrieved', { count, unreadCount: count });
});

const markRead = asyncHandler(async (req, res) => {
  const data = await service.readNotification(req.user, req.params.id, req.tenant);
  return ApiResponse.ok(res, data, 'Notification marked as read');
});

const markAllRead = asyncHandler(async (req, res) => {
  await service.readAllNotifications(req.user, req.tenant);
  return ApiResponse.ok(res, null, 'All notifications marked as read');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteNotification(req.user, req.params.id, req.tenant);
  return ApiResponse.ok(res, null, 'Notification removed');
});

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove
};
