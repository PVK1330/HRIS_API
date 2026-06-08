'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Read directly from process.env — logger initialises before env.js validation.
// Default: 'debug' in development so logger.debug() calls are visible; 'info'
// in production so debug output never reaches prod logs unless explicitly opted in.
const logLevel =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'hris-api' },
  transports: [
    // Write all logs with importance level of `error` or less to `error.log`
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Pin combined.log at 'info' regardless of LOG_LEVEL so debug output
    // never floods the log files when running locally.
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// In development, log to the console with a human-readable line that matches
// production usefulness: `HH:mm:ss level: message` plus the full stack for
// errors and any structured metadata. (Production keeps the JSON file format.)
if (process.env.NODE_ENV !== 'production') {
  const devConsoleFormat = winston.format.printf((info) => {
    const { timestamp, level, message, stack, service, ...meta } = info;

    // For errors, `stack` carries the message + full trace; otherwise use message.
    let line = `${timestamp} ${level}: ${stack || message}`;

    // Append any remaining structured metadata (Errors → their stack).
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      const cleaned = {};
      for (const key of metaKeys) {
        const value = meta[key];
        cleaned[key] = value instanceof Error ? value.stack || value.message : value;
      }
      try {
        line += ` ${JSON.stringify(cleaned)}`;
      } catch {
        line += ` ${cleaned}`;
      }
    }

    return line;
  });

  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      devConsoleFormat
    ),
  }));
}

module.exports = logger;
