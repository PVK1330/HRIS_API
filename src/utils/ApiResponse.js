'use strict';

/**
 * Standardized success response wrapper.
 * Always emits { success: true, message, data }.
 */
class ApiResponse {
  constructor(statusCode, data = null, message = 'Success') {
    this.statusCode = statusCode;
    this.success = statusCode >= 200 && statusCode < 400;
    this.message = message;
    this.data = data;
  }

  /**
   * Send the response on the given Express res object.
   * Extra top-level fields (e.g. `token`) can be merged via `extra`.
   */
  send(res, extra = {}) {
    return res.status(this.statusCode).json({
      success: this.success,
      message: this.message,
      data: this.data,
      ...extra,
    });
  }

  static ok(res, data, message = 'Success', extra = {}) {
    return new ApiResponse(200, data, message).send(res, extra);
  }

  static created(res, data, message = 'Created', extra = {}) {
    return new ApiResponse(201, data, message).send(res, extra);
  }
}

module.exports = ApiResponse;
