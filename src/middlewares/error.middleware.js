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

  // Postgres unique-violation (23505): return a clear 409 "duplicate value" instead
  // of leaking a raw 500. Try to surface the offending column/value from err.detail
  // ("Key (code)=(IT0001) already exists."); fall back to a generic message for
  // composite/expression constraints.
  if (!isApiError && err && err.code === "23505") {
    const m = /Key \(([^)]+)\)=\(([^)]*)\)/.exec(err.detail || "");
    let field = m ? m[1] : null;
    const value = m && m[2] ? m[2] : null;
    if (field && /[(),]/.test(field)) field = null; // composite/expression → keep generic
    const message = field
      ? `A record with this ${field}${value ? ` "${value}"` : ""} already exists.`
      : "A record with a duplicate value already exists.";
    logger.warn(
      `${req.method} ${req.originalUrl} -> 409 duplicate (${err.constraint || "unique_violation"})`,
    );
    return res.status(409).json({ success: false, message });
  }

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
