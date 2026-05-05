// src/modules/superadmin/features.controller.js
const featuresRepository = require('./features.repository');

/**
 * Get all features
 */
const getAllFeatures = async (req, res, next) => {
  try {
    const filters = {
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      category: req.query.category
    };
    const features = await featuresRepository.findAll(filters);
    return res.status(200).json({
      success: true,
      data: features,
      message: 'Features retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all feature categories
 */
const getCategories = async (req, res, next) => {
  try {
    const categories = await featuresRepository.getCategories();
    return res.status(200).json({
      success: true,
      data: categories,
      message: 'Categories retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get features by category
 */
const getFeaturesByCategory = async (req, res, next) => {
  try {
    const features = await featuresRepository.findByCategory(req.params.category);
    return res.status(200).json({
      success: true,
      data: features,
      message: 'Features retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get feature by ID
 */
const getFeatureById = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found'
      });
    }
    return res.status(200).json({
      success: true,
      data: feature,
      message: 'Feature retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new feature
 */
const createFeature = async (req, res, next) => {
  try {
    const { name, code, description, category, isActive } = req.body;

    // Validation
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Name and code are required'
      });
    }

    // Check if code already exists
    const existingFeature = await featuresRepository.findByCode(code);
    if (existingFeature) {
      return res.status(409).json({
        success: false,
        message: 'Feature code already exists'
      });
    }

    const feature = await featuresRepository.create({
      name,
      code,
      description,
      category,
      isActive
    });

    return res.status(201).json({
      success: true,
      data: feature,
      message: 'Feature created successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update feature
 */
const updateFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found'
      });
    }

    // Check if code is being changed and if new code already exists
    if (req.body.code && req.body.code !== feature.code) {
      const existingFeature = await featuresRepository.findByCode(req.body.code);
      if (existingFeature) {
        return res.status(409).json({
          success: false,
          message: 'Feature code already exists'
        });
      }
    }

    const updatedFeature = await featuresRepository.update(req.params.id, req.body);
    return res.status(200).json({
      success: true,
      data: updatedFeature,
      message: 'Feature updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete feature (soft delete)
 */
const deleteFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found'
      });
    }

    const deletedFeature = await featuresRepository.delete(req.params.id);
    return res.status(200).json({
      success: true,
      data: deletedFeature,
      message: 'Feature deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Activate feature
 */
const activateFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found'
      });
    }

    const activatedFeature = await featuresRepository.activate(req.params.id);
    return res.status(200).json({
      success: true,
      data: activatedFeature,
      message: 'Feature activated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Deactivate feature
 */
const deactivateFeature = async (req, res, next) => {
  try {
    const feature = await featuresRepository.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found'
      });
    }

    const deactivatedFeature = await featuresRepository.deactivate(req.params.id);
    return res.status(200).json({
      success: true,
      data: deactivatedFeature,
      message: 'Feature deactivated successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllFeatures,
  getCategories,
  getFeaturesByCategory,
  getFeatureById,
  createFeature,
  updateFeature,
  deleteFeature,
  activateFeature,
  deactivateFeature
};
