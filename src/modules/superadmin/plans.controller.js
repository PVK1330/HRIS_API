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
    
    // Enrich plans with features
    const plansWithFeatures = await Promise.all(
      plans.map(async (plan) => {
        const features = await plansRepository.getFeatures(plan.id);
        return { ...plan, features };
      })
    );

    return res.status(200).json({
      success: true,
      data: plansWithFeatures,
      message: 'Plans retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get active subscription plans
 */
const getActivePlans = async (req, res, next) => {
  try {
    const plans = await plansRepository.findAll({ isActive: true });

    // Enrich plans with features
    const plansWithFeatures = await Promise.all(
      plans.map(async (plan) => {
        const features = await plansRepository.getFeatures(plan.id);
        return { ...plan, features };
      })
    );

    return res.status(200).json({
      success: true,
      data: plansWithFeatures,
      message: 'Active plans retrieved successfully'
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

    // Get associated features
    const features = await plansRepository.getFeatures(req.params.id);
    plan.features = features;

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
      plan_name,
      plan_code,
      plan_description,
      monthly_price,
      annual_price,
      user_quota,
      storage_quota_gb,
      company_quota,
      trial_days,
      support_level,
      is_popular,
      is_custom,
      isActive
    } = req.body;

    // Validation
    if (!plan_name || !plan_code) {
      return res.status(400).json({
        success: false,
        message: 'plan_name and plan_code are required'
      });
    }

    // Check if code already exists
    const existingPlan = await plansRepository.findByCode(plan_code);
    if (existingPlan) {
      return res.status(409).json({
        success: false,
        message: 'Plan code already exists'
      });
    }

    const plan = await plansRepository.create({
      plan_name,
      plan_code,
      plan_description,
      monthly_price,
      annual_price,
      user_quota,
      storage_quota_gb,
      company_quota,
      trial_days,
      support_level,
      is_popular,
      is_custom,
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
    if (req.body.plan_code && req.body.plan_code !== plan.plan_code) {
      const existingPlan = await plansRepository.findByCode(req.body.plan_code);
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
    const { id } = req.params;
    const { featureId } = req.body;

    if (!featureId) {
      return res.status(400).json({
        success: false,
        message: 'featureId is required'
      });
    }

    const mapping = await plansRepository.addFeature(id, featureId);
    return res.status(201).json({
      success: true,
      data: mapping,
      message: 'Feature added to plan'
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
    const { id, feature } = req.params; // feature is the featureId
    await plansRepository.removeFeature(id, feature);
    return res.status(200).json({
      success: true,
      message: 'Feature removed from plan'
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
    const { id } = req.params;
    const { featureIds } = req.body; // Expects an array of IDs

    if (!Array.isArray(featureIds)) {
      return res.status(400).json({
        success: false,
        message: 'featureIds must be an array'
      });
    }

    await plansRepository.syncFeatures(id, featureIds);
    return res.status(200).json({
      success: true,
      message: 'Plan features updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPlans,
  getActivePlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  addFeature,
  removeFeature,
  updateFeatures
};
