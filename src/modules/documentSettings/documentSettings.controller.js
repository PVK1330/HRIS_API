'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const documentSettingsService = require('./documentSettings.service');

const getAll = asyncHandler(async (req, res) => {
  const data = await documentSettingsService.getAllDocumentTypes(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const data = await documentSettingsService.getDocumentTypeById(
    req.tenant.dbName,
    req.params.id
  );
  res.status(200).json({ success: true, data });
});

const create = asyncHandler(async (req, res) => {
  const data = await documentSettingsService.createDocumentType(req.tenant.dbName, req.body);
  res.status(201).json({ success: true, data });
});

const update = asyncHandler(async (req, res) => {
  const data = await documentSettingsService.updateDocumentType(
    req.tenant.dbName,
    req.params.id,
    req.body
  );
  res.status(200).json({ success: true, data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await documentSettingsService.deleteDocumentType(
    req.tenant.dbName,
    req.params.id
  );
  res.status(200).json({ success: true, data });
});

module.exports = {
  getAll,
  getOne,
  create,
  update,
  remove,
};
