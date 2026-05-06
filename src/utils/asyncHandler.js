'use strict';

/**
 * Wraps an async Express handler so that any thrown / rejected error
 * is forwarded to the next() middleware (i.e. the global error handler).
 *
 * Usage:
 *   router.post('/x', asyncHandler(async (req, res, next) => { ... }))
 */
function asyncHandler(fn) {
  return function asyncWrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
