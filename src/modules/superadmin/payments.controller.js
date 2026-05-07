// src/modules/superadmin/payments.controller.js
const paymentsRepository = require('./payments.repository');
const { ApiResponse } = require('../../utils/apiResponse');

const getPayments = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const { search, status } = req.query;

    const [payments, total] = await Promise.all([
      paymentsRepository.findAll({ limit, offset, search, status }),
      paymentsRepository.countAll({ search, status })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        payments,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      },
      message: 'Payments retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

const getPaymentStats = async (req, res, next) => {
  try {
    const stats = await paymentsRepository.getStats();
    return res.status(200).json({
      success: true,
      data: stats,
      message: 'Payment stats retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

const updatePaymentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const processedBy = req.user.id;

    if (!['completed', 'failed', 'refunded'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const updated = await paymentsRepository.updateStatus(id, status, processedBy);
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: updated,
      message: 'Payment status updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

const createManualInvoice = async (req, res, next) => {
  try {
    const {
      tenant_id,
      amount,
      currency,
      billing_start_date,
      billing_end_date,
      notes,
      payment_method
    } = req.body;

    if (!tenant_id || !amount || !billing_start_date || !billing_end_date) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id, amount, billing_start_date, billing_end_date are required'
      });
    }

    if (new Date(billing_start_date) > new Date(billing_end_date)) {
      return res.status(400).json({
        success: false,
        message: 'billing_start_date must be before billing_end_date'
      });
    }

    const invoice = await paymentsRepository.createManualInvoice({
      tenantId: Number(tenant_id),
      amount: Number(amount),
      currency: currency || 'AED',
      billingStartDate: billing_start_date,
      billingEndDate: billing_end_date,
      notes,
      paymentMethod: payment_method || 'Manual'
    });

    return res.status(201).json({
      success: true,
      data: invoice,
      message: 'Manual invoice created successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPayments,
  getPaymentStats,
  updatePaymentStatus,
  createManualInvoice
};
