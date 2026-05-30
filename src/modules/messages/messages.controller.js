'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./messages.service');

const listContacts = asyncHandler(async (req, res) => {
  const data = await service.listContacts(req.user, req.query);
  return ApiResponse.ok(res, { contacts: data }, 'Contacts retrieved');
});

const listConversations = asyncHandler(async (req, res) => {
  const data = await service.listConversations(req.user);
  return ApiResponse.ok(res, { conversations: data }, 'Conversations retrieved');
});

const openConversation = asyncHandler(async (req, res) => {
  const data = await service.openConversation(req.user, req.body.otherEmployeeId);
  return ApiResponse.ok(res, data, 'Conversation opened');
});

const getMessages = asyncHandler(async (req, res) => {
  const data = await service.getMessages(req.user, req.params.id, req.query);
  return ApiResponse.ok(res, data, 'Messages retrieved');
});

const sendMessage = asyncHandler(async (req, res) => {
  const data = await service.sendMessage(req.user, req.params.id, req.body.body);
  return ApiResponse.created(res, { message: data }, 'Message sent');
});

const sendMessageAttachment = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  const data = await service.sendMessageAttachment(
    req.user,
    req.params.id,
    req.file,
    req.body?.body || '',
  );
  return ApiResponse.created(res, { message: data }, 'Attachment sent');
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await service.getUnreadCount(req.user);
  return ApiResponse.ok(res, { unread: count }, 'Unread count');
});

module.exports = {
  listContacts,
  listConversations,
  openConversation,
  getMessages,
  sendMessage,
  sendMessageAttachment,
  unreadCount,
};
