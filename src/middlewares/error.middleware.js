"use strict";

const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");

function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, _next) {
  const isProd = process.env.NODE_ENV === "production";
  const isApiError = err instanceof ApiError;

  const statusCode = isApiError ? err.statusCode : 500;
  const message = isApiError
    ? err.message
    : isProd
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

  logger.error(
    `${req.method} ${req.originalUrl} -> ${statusCode} ${message}`,
    isProd ? "" : err.stack || "",
  );

  const body = {
    success: false,
    message,
  };

  if (isApiError && Array.isArray(err.errors) && err.errors.length > 0) {
    body.errors = err.errors;
  }

  if (!isProd && !isApiError && err.stack) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
