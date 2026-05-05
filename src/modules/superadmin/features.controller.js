// src/modules/superadmin/features.controller.js
const featuresRepository = require('./features.repository');

const getAllFeatures = async (req, res, next) => {
  try {
    const filters = {
      feature_is_active: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      search: req.query.search
    };

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const options = {
      paginate: true,
      limit,
      offset
    };

    const result = await featuresRepository.findAll(filters, options);
    
    return res.status(200).json({
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      },
      message: 'Features retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

const getActiveFeatures = async (req, res, next) => {
  try {
    const filters = { feature_is_active: true };
    const features = await featuresRepository.findAll(filters, { paginate: false });
    return res.status(200).json({
      success: true,
      data: features,
      message: 'Active features retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

const getFeatureById = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({ success: false, message: 'Feature not found' });
    }
    return res.status(200).json({ success: true, data: feature, message: 'Feature retrieved successfully' });
  } catch (error) {
    next(error);
  }
};

const createFeature = async (req, res, next) => {
  try {
    const { feature_name, feature_code, feature_description, feature_sort_order, feature_is_active } = req.body;

    if (!feature_name || !feature_code) {
      return res.status(400).json({ success: false, message: 'feature_name and feature_code are required' });
    }

    const existingFeature = await featuresRepository.findByCode(feature_code);
    if (existingFeature) {
      return res.status(409).json({ success: false, message: 'Feature code already exists' });
    }

    const feature = await featuresRepository.create({
      feature_name,
      feature_code,
      feature_description,
      feature_sort_order,
      feature_is_active
    });

    return res.status(201).json({ success: true, data: feature, message: 'Feature created successfully' });
  } catch (error) {
    next(error);
  }
};

const updateFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({ success: false, message: 'Feature not found' });
    }

    if (req.body.feature_code && req.body.feature_code !== feature.feature_code) {
      const existingFeature = await featuresRepository.findByCode(req.body.feature_code);
      if (existingFeature) {
        return res.status(409).json({ success: false, message: 'Feature code already exists' });
      }
    }

    const updatedFeature = await featuresRepository.update(req.params.id, req.body);
    return res.status(200).json({ success: true, data: updatedFeature, message: 'Feature updated successfully' });
  } catch (error) {
    next(error);
  }
};

const deleteFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({ success: false, message: 'Feature not found' });
    }
    const deletedFeature = await featuresRepository.delete(req.params.id);
    return res.status(200).json({ success: true, data: deletedFeature, message: 'Feature deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const activateFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({ success: false, message: 'Feature not found' });
    }
    const activatedFeature = await featuresRepository.activate(req.params.id);
    return res.status(200).json({ success: true, data: activatedFeature, message: 'Feature activated successfully' });
  } catch (error) {
    next(error);
  }
};

const deactivateFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({ success: false, message: 'Feature not found' });
    }
    const deactivatedFeature = await featuresRepository.deactivate(req.params.id);
    return res.status(200).json({ success: true, data: deactivatedFeature, message: 'Feature deactivated successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllFeatures,
  getActiveFeatures,
  getFeatureById,
  createFeature,
  updateFeature,
  deleteFeature,
  activateFeature,
  deactivateFeature
};
