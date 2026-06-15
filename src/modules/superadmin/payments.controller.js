// src/modules/superadmin/payments.controller.js
const paymentsRepository = require('./payments.repository');
const { ApiResponse } = require('../../utils/apiResponse');
const { renderEmail } = require('../../utils/emailTemplate');
const exportLib = require('./superadmin.export');

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

const getInvoiceHtml = async (req, res, next) => {
  try {
    const { id } = req.params;
    const invoice = await paymentsRepository.findById(id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const issueDate = new Date(invoice.created_at).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const billingCycle = `${new Date(invoice.billing_start_date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })} - ${new Date(invoice.billing_end_date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })}`;

    const { html } = await renderEmail('invoice', {
      name: invoice.tenant_name || 'Tenant',
      email: invoice.admin_email || '-',
      invoiceId: invoice.id,
      date: issueDate,
      planName: invoice.plan_name || 'Subscription',
      billingCycle,
      currency: invoice.currency || 'AED',
      amount: Number(invoice.amount || 0).toLocaleString(),
      status: String(invoice.status || 'pending').toUpperCase(),
      statusMessage:
        invoice.status === 'completed'
          ? 'Payment has been successfully completed.'
          : invoice.status === 'failed'
            ? 'Payment failed. Please retry or update payment method.'
            : invoice.status === 'refunded'
              ? 'This invoice has been refunded.'
              : 'Payment is pending confirmation.'
    }, { preferUrl: true });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    next(error);
  }
};

const exportPayments = async (req, res, next) => {
  try {
    const { search = '', status = '' } = req.query;
    const rows = await paymentsRepository.findAll({ limit: 10000, offset: 0, search, status });
    const format = String(req.query.format || 'excel').toLowerCase();
    if (format === 'pdf') return exportLib.buildPaymentsPDF(res, rows, { search, status });
    return exportLib.buildPaymentsExcel(res, rows, { search, status });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPayments,
  getPaymentStats,
  updatePaymentStatus,
  createManualInvoice,
  getInvoiceHtml,
  exportPayments,
};
