"use strict";

const { validationResult } = require("express-validator");
const ApiError = require("../utils/ApiError");

function validate(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return next();
  }

  const errors = result.array().map((e) => ({
    field: e.path || e.param,
    message: e.msg,
    value: e.value,
    location: e.location,
  }));

  return next(new ApiError(400, "Validation failed", errors));
}

module.exports = validate;
