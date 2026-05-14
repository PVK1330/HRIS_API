'use strict';

const service = require('./adminDocuments.service');
const ApiResponse = require('../../utils/ApiResponse');

exports.listAll = async (req, res, next) => {
  try {
    const data = await service.listAllDocuments(req.tenant.dbName);
    return ApiResponse.ok(res, data);
  } catch (err) {
    next(err);
  }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;
    const actorId = req.user.id;
    const actorName = req.user.full_name || req.user.email;
    const data = await service.updateStatus(req.tenant.dbName, id, { status, rejection_reason, actorId, actorName });
    return ApiResponse.ok(res, data, 'Document status updated');
  } catch (err) {
    next(err);
  }
};
