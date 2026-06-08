"use strict";

const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");
const env = require("../config/env");

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

  // Always log the stack server-side (including production) so traces are
  // never lost — they just don't leave the server.
  logger.error(
    `${req.method} ${req.originalUrl} -> ${statusCode} ${message}`,
    err.stack || "",
  );

  const body = {
    success: false,
    message,
  };

  if (isApiError && Array.isArray(err.errors) && err.errors.length > 0) {
    body.errors = err.errors;
  }

  // Expose the stack in the response ONLY when explicitly opted in via
  // EXPOSE_STACK=true and never in production.
  if (env.EXPOSE_STACK && !isProd && !isApiError && err.stack) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
