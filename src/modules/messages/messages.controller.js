'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse  = require('../../utils/ApiResponse');
const service      = require('./messages.service');

// GET /api/v1/messages/conversations
const listConversations = asyncHandler(async (req, res) => {
  const data = await service.listConversations(req.user);
  return ApiResponse.ok(res, { conversations: data }, 'Conversations retrieved');
});

// POST /api/v1/messages/conversations  { otherEmployeeId }
const openConversation = asyncHandler(async (req, res) => {
  const data = await service.openConversation(req.user, req.body.otherEmployeeId);
  return ApiResponse.ok(res, data, 'Conversation opened');
});

// GET /api/v1/messages/conversations/:id/messages?limit=50&before=<msgId>
const getMessages = asyncHandler(async (req, res) => {
  const data = await service.getMessages(req.user, req.params.id, req.query);
  return ApiResponse.ok(res, data, 'Messages retrieved');
});

// POST /api/v1/messages/conversations/:id/messages  { body }
const sendMessage = asyncHandler(async (req, res) => {
  const data = await service.sendMessage(req.user, req.params.id, req.body.body);
  return ApiResponse.created(res, { message: data }, 'Message sent');
});

// GET /api/v1/messages/unread
const unreadCount = asyncHandler(async (req, res) => {
  const count = await service.getUnreadCount(req.user);
  return ApiResponse.ok(res, { unread: count }, 'Unread count');
});

module.exports = { listConversations, openConversation, getMessages, sendMessage, unreadCount };
