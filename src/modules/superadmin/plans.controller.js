// src/modules/superadmin/plans.controller.js
const plansRepository = require('./plans.repository');

/**
 * Get all subscription plans
 */
const getAllPlans = async (req, res, next) => {
  try {
    const filters = {
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined
    };
    const plans = await plansRepository.findAll(filters);
    return res.status(200).json({
      success: true,
      data: plans,
      message: 'Plans retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get plan by ID
 */
const getPlanById = async (req, res, next) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    return res.status(200).json({
      success: true,
      data: plan,
      message: 'Plan retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new subscription plan
 */
const createPlan = async (req, res, next) => {
  try {
    const {
      name,
      code,
      description,
      maxUsers,
      maxStorageMb,
      priceMonthly,
      priceYearly,
      features,
      isActive
    } = req.body;

    // Validation
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Name and code are required'
      });
    }

    // Check if code already exists
    const existingPlan = await plansRepository.findByCode(code);
    if (existingPlan) {
      return res.status(409).json({
        success: false,
        message: 'Plan code already exists'
      });
    }

    const plan = await plansRepository.create({
      name,
      code,
      description,
      maxUsers,
      maxStorageMb,
      priceMonthly,
      priceYearly,
      features,
      isActive
    });

    return res.status(201).json({
      success: true,
      data: plan,
      message: 'Plan created successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update subscription plan
 */
const updatePlan = async (req, res, next) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Check if code is being changed and if new code already exists
    if (req.body.code && req.body.code !== plan.code) {
      const existingPlan = await plansRepository.findByCode(req.body.code);
      if (existingPlan) {
        return res.status(409).json({
          success: false,
          message: 'Plan code already exists'
        });
      }
    }

    const updatedPlan = await plansRepository.update(req.params.id, req.body);
    return res.status(200).json({
      success: true,
      data: updatedPlan,
      message: 'Plan updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete subscription plan (soft delete)
 */
const deletePlan = async (req, res, next) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    const deletedPlan = await plansRepository.delete(req.params.id);
    return res.status(200).json({
      success: true,
      data: deletedPlan,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add feature to plan
 */
const addFeature = async (req, res, next) => {
  try {
    const { feature } = req.body;
    if (!feature) {
      return res.status(400).json({
        success: false,
        message: 'Feature is required'
      });
    }

    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    const updatedPlan = await plansRepository.addFeature(req.params.id, feature);
    return res.status(200).json({
      success: true,
      data: updatedPlan,
      message: 'Feature added successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove feature from plan
 */
const removeFeature = async (req, res, next) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    const updatedPlan = await plansRepository.removeFeature(req.params.id, req.params.feature);
    return res.status(200).json({
      success: true,
      data: updatedPlan,
      message: 'Feature removed successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update features list
 */
const updateFeatures = async (req, res, next) => {
  try {
    const { features } = req.body;
    if (!Array.isArray(features)) {
      return res.status(400).json({
        success: false,
        message: 'Features must be an array'
      });
    }

    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    const updatedPlan = await plansRepository.updateFeatures(req.params.id, features);
    return res.status(200).json({
      success: true,
      data: updatedPlan,
      message: 'Features updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  addFeature,
  removeFeature,
  updateFeatures
};
