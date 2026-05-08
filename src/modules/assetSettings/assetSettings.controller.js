'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const assetSettingsService = require('./assetSettings.service');

const getCategories = asyncHandler(async (req, res) => {
  const data = await assetSettingsService.getCategories(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const createCategory = asyncHandler(async (req, res) => {
  const data = await assetSettingsService.createCategory(req.tenant.dbName, req.body);
  res.status(201).json({ success: true, data });
});

const updateCategory = asyncHandler(async (req, res) => {
  const data = await assetSettingsService.updateCategory(
    req.tenant.dbName,
    req.params.id,
    req.body
  );
  res.status(200).json({ success: true, data });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const data = await assetSettingsService.deleteCategory(req.tenant.dbName, req.params.id);
  res.status(200).json({ success: true, data });
});

const getAssetRules = asyncHandler(async (req, res) => {
  const data = await assetSettingsService.getAssetRules(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const updateAssetRules = asyncHandler(async (req, res) => {
  const data = await assetSettingsService.updateAssetRules(req.tenant.dbName, req.body);
  res.status(200).json({
    success: true,
    message: 'Asset rules updated',
    data,
  });
});

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAssetRules,
  updateAssetRules,
};
