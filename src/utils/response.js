/**
 * Standard API Response Formatter for Enterprise SaaS
 */

function apiSuccess(res, data = null, meta = null, message = null, statusCode = 200) {
  const payload = {
    success: true,
    data
  };

  if (meta) payload.meta = meta;
  if (message) payload.message = message;
  if (res.req && res.req.id) payload.requestId = res.req.id;

  return res.status(statusCode).json(payload);
}

function apiError(res, message = 'An error occurred', statusCode = 500, errors = null, code = null) {
  const payload = {
    success: false,
    error: {
      message,
      statusCode
    }
  };

  if (code) payload.error.code = code;
  if (errors) payload.error.details = errors;
  if (res.req && res.req.id) payload.requestId = res.req.id;

  return res.status(statusCode).json(payload);
}

module.exports = {
  apiSuccess,
  apiError
};
