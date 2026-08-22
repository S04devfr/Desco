const crypto = require('crypto');

/**
 * Enterprise Correlation ID Middleware
 * Assigns a unique X-Request-Id to each incoming HTTP request
 * and binds it to res headers and req object for tracing.
 */
function requestIdMiddleware(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}

module.exports = requestIdMiddleware;
