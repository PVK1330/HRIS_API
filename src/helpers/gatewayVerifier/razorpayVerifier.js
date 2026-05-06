"use strict";

const axios = require("axios");

const RAZORPAY_URL = "https://api.razorpay.com/v1/payments?count=1";

async function verify({ key_id, key_secret } = {}) {
  if (!key_id || !key_secret) {
    return {
      success: false,
      message: "Razorpay key_id and key_secret are required",
    };
  }

  const auth = Buffer.from(`${key_id}:${key_secret}`).toString("base64");

  try {
    const res = await axios.get(RAZORPAY_URL, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (res.status === 200) {
      return {
        success: true,
        message: "Razorpay credentials verified successfully",
      };
    }
    if (res.status === 401) {
      return { success: false, message: "Invalid Razorpay key ID or secret" };
    }
    const detail =
      (res.data && res.data.error && res.data.error.description) ||
      `Razorpay returned HTTP ${res.status}`;
    return { success: false, message: detail };
  } catch (err) {
    return {
      success: false,
      message:
        err && err.message ? err.message : "Razorpay verification failed",
    };
  }
}

module.exports = { verify };
