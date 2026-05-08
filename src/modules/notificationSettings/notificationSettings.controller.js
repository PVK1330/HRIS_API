'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const notificationSettingsService = require('./notificationSettings.service');

const getNotificationSettings = asyncHandler(async (req, res) => {
  const data = await notificationSettingsService.getNotificationSettings(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const updateNotificationSettings = asyncHandler(async (req, res) => {
  const data = await notificationSettingsService.updateNotificationSettings(
    req.tenant.dbName,
    req.body
  );
  res.status(200).json({
    success: true,
    message: 'Notification settings updated',
    data,
  });
});

const updateSingleEvent = asyncHandler(async (req, res) => {
  const data = await notificationSettingsService.updateEventNotification(
    req.tenant.dbName,
    req.params.eventKey,
    req.body
  );
  res.status(200).json({ success: true, data });
});

module.exports = {
  getNotificationSettings,
  updateNotificationSettings,
  updateSingleEvent,
};
