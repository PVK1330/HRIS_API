'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Express middleware: validate req[property] with a Joi schema.
 * On success, replaces the property with the validated value (stripUnknown).
 *
 * @param {import('joi').ObjectSchema} schema
 * @param {'body'|'query'|'params'} [property='body']
 */
function validateWithJoi(schema, property = 'body') {
  return (req, _res, next) => {
    const target = req[property];
    const { error, value } = schema.validate(target, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.length ? d.path.join('.') : '_',
        message: d.message.replace(/"/g, ''),
      }));
      const msg = errors.map((e) => e.message).join('; ');
      return next(new ApiError(400, msg, errors));
    }
    req[property] = value;
    return next();
  };
}

module.exports = { validateWithJoi };
