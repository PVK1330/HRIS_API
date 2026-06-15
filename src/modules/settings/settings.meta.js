'use strict';

const settingsMeta = {
  navigation: {
    sections: [
      {
        key: 'general',
        label: 'General',
        items: [
          { label: 'General Settings', to: '/superadmin/settings/general' },
          { label: 'Company Details', to: '/superadmin/settings/company' },
          // { label: 'Domain Settings', to: '/superadmin/settings/domain' },
          { label: 'Logo', to: '/superadmin/settings/logo' },
        ],
      },
      {
        key: 'security',
        label: 'Security',
        items: [
          { label: 'Account Settings', to: '/superadmin/settings/account-settings' },
          // { label: 'reCAPTCHA', to: '/superadmin/settings/recaptcha' },
        ],
      },
      {
        key: 'billing',
        label: 'Billing',
        items: [
          { label: 'Currency', to: '/superadmin/settings/currency' },
          { label: 'Free Trial', to: '/superadmin/settings/free-trial' },
          { label: 'Payment Gateways', to: '/superadmin/settings/payments' },
        ],
      },
      {
        key: 'integrations',
        label: 'Integrations',
        items: [
          // { label: 'Email Templates', to: '/superadmin/settings/email/templates' },
          { label: 'SMTP Settings', to: '/superadmin/settings/email/settings' },
          { label: 'Email Log', to: '/superadmin/settings/email/log' },
        ],
      },
    ],
  },
  general: {
    languages: [
      { value: 'English', label: 'English' },
      { value: 'French', label: 'French' },
      { value: 'Spanish', label: 'Spanish' },
      { value: 'Arabic', label: 'Arabic' },
      { value: 'Urdu', label: 'Urdu' },
      { value: 'Hindi', label: 'Hindi' },
    ],
    timezones: [
      { value: 'UTC', label: 'UTC' },
      { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
      { value: 'Asia/Dubai', label: 'Asia/Dubai' },
      { value: 'America/New_York', label: 'America/New_York' },
      { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
      { value: 'Europe/London', label: 'UK — Europe/London' },
      { value: 'Europe/Paris', label: 'Europe/Paris' },
      { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
    ],
    dateFormats: [
      { value: 'd-m-Y', label: 'd-m-Y' },
      { value: 'm-d-Y', label: 'm-d-Y' },
      { value: 'Y-m-d', label: 'Y-m-d' },
    ],
    dateSelectorFormats: [
      { value: 'dd-mm-yyyy', label: 'dd-mm-yyyy' },
      { value: 'mm-dd-yyyy', label: 'mm-dd-yyyy' },
      { value: 'yyyy-mm-dd', label: 'yyyy-mm-dd' },
    ],
  },
  email: {
    deliveryOptions: [{ value: 'smtp', label: 'SMTP' }],
    encryptionOptions: [
      { value: 'tls', label: 'TLS' },
      { value: 'ssl', label: 'SSL' },
      { value: 'none', label: 'None' },
    ],
  },
  currency: {
    options: [
      { value: 'USD', label: 'USD ($)', symbol: '$' },
      { value: 'EUR', label: 'EUR (€)', symbol: '€' },
      { value: 'GBP', label: 'GBP (£)', symbol: '£' },
      { value: 'INR', label: 'INR (₹)', symbol: '₹' },
      { value: 'AED', label: 'AED (د.إ)', symbol: 'د.إ' },
      { value: 'SAR', label: 'SAR (﷼)', symbol: '﷼' },
      { value: 'QAR', label: 'QAR (﷼)', symbol: '﷼' },
      { value: 'KWD', label: 'KWD (د.ك)', symbol: 'د.ك' },
      { value: 'BHD', label: 'BHD (.د.ب)', symbol: '.د.ب' },
      { value: 'OMR', label: 'OMR (﷼)', symbol: '﷼' },
      { value: 'CAD', label: 'CAD ($)', symbol: '$' },
      { value: 'AUD', label: 'AUD ($)', symbol: '$' },
      { value: 'SGD', label: 'SGD ($)', symbol: '$' },
      { value: 'MYR', label: 'MYR (RM)', symbol: 'RM' },
      { value: 'PKR', label: 'PKR (₨)', symbol: '₨' },
      { value: 'BDT', label: 'BDT (৳)', symbol: '৳' },
      { value: 'LKR', label: 'LKR (₨)', symbol: '₨' },
      { value: 'NPR', label: 'NPR (₨)', symbol: '₨' },
      { value: 'JPY', label: 'JPY (¥)', symbol: '¥' },
      { value: 'CNY', label: 'CNY (¥)', symbol: '¥' },
    ],
    symbolPositions: [
      { value: 'before', label: 'Before Amount ($100)' },
      { value: 'after', label: 'After Amount (100$)' },
    ],
    decimalOptions: [
      { value: '.', label: 'Period (.)' },
      { value: ',', label: 'Comma (,)' },
    ],
    thousandOptions: [
      { value: ',', label: 'Comma (,)' },
      { value: '.', label: 'Period (.)' },
      { value: ' ', label: 'Space ( )' },
      { value: '', label: 'None' },
    ],
  },
  paymentGateways: {
    order: ['stripe', 'offline'],
    meta: {
      stripe: {
        label: 'Stripe',
        subtitle: 'ENTERPRISE FINANCIAL INFRASTRUCTURE',
        icon: 'credit-card',
        iconBg: 'bg-indigo-600',
        showTestMode: true,
        fields: [
          { key: 'publishable_key', label: 'Publishable Key', type: 'text', required: true, placeholder: 'pk_test_...' },
          { key: 'secret_key', label: 'Secret Key', type: 'password', required: true, placeholder: 'sk_test_...' },
          { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', required: false, placeholder: 'whsec_...' },
        ],
      },
      offline: {
        label: 'Offline Transfer',
        subtitle: 'DIRECT BANK TRANSFERS',
        icon: 'building-library',
        iconBg: 'bg-green-600',
        showTestMode: false,
        fields: [
          { key: 'bank_name', label: 'Bank Name', type: 'text', required: true, placeholder: '' },
          { key: 'account_holder', label: 'Account Holder Name', type: 'text', required: true, placeholder: '' },
          { key: 'account_number', label: 'Account Number', type: 'text', required: true, placeholder: '' },
          { key: 'ifsc_code', label: 'IFSC Code', type: 'text', required: false, placeholder: 'SBIN0001234' },
          { key: 'instructions', label: 'Instructions', type: 'textarea', required: false, placeholder: 'Payment instructions for customers...' },
        ],
      },
    },
  },
};

module.exports = settingsMeta;
