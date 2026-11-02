import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../lib/errors.js';

/** Consistent response envelope: { data, error }. */
export const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });

export function requestLogger(logger) {
  return (req, res, next) => {
    const started = Date.now();
    req.id = req.get('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', req.id);
    res.on('finish', () => {
      logger.info('http.request', {
        request_id: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        duration_ms: Date.now() - started,
      });
    });
    next();
  };
}

/**
 * Authenticates Vapi webhooks via the shared secret Vapi sends in the
 * `x-vapi-secret` header (configured in assistantConfig.js). In production a
 * missing secret is a misconfiguration and every request is rejected.
 */
export function vapiAuth({ secret, isProduction, logger }) {
  const expected = secret ? Buffer.from(secret) : null;
  return (req, res, next) => {
    if (!expected) {
      if (isProduction) {
        logger.error('vapi.auth.secret_missing');
        return res.status(500).json({ data: null, error: { code: 'misconfigured', message: 'Webhook secret not configured.' } });
      }
      return next(); // local development without a secret
    }
    const provided = Buffer.from(req.get('x-vapi-secret') ?? '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      logger.warn('vapi.auth.rejected', { request_id: req.id });
      return res.status(401).json({ data: null, error: { code: 'unauthorized', message: 'Invalid webhook secret.' } });
    }
    return next();
  };
}

export function notFoundHandler(req, res) {
  res.status(404).json({ data: null, error: { code: 'not_found', message: `No route for ${req.method} ${req.path}.` } });
}

// Postgres error codes that indicate bad client input rather than a server fault.
const PG_CLIENT_ERRORS = {
  '23514': [422, 'validation_error', 'A field value violates a database constraint.'], // check_violation
  '23502': [422, 'validation_error', 'A required field is missing.'], // not_null_violation
  '22001': [422, 'validation_error', 'A field value is too long.'], // string_data_right_truncation
  '22P02': [400, 'bad_request', 'A field has an invalid format.'], // invalid_text_representation
  '22007': [400, 'bad_request', 'Invalid date format.'], // invalid_datetime_format
  '22008': [400, 'bad_request', 'Date out of range.'], // datetime_field_overflow
  '23503': [422, 'validation_error', 'Referenced record does not exist.'], // foreign_key_violation
};

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    // Malformed JSON body from express.json().
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ data: null, error: { code: 'bad_request', message: 'Request body is not valid JSON.' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ data: null, error: { code: 'payload_too_large', message: 'Request body is too large.' } });
    }
    if (err instanceof AppError) {
      return res.status(err.status).json({
        data: null,
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
    }
    if (err.code && PG_CLIENT_ERRORS[err.code]) {
      const [status, code, message] = PG_CLIENT_ERRORS[err.code];
      return res.status(status).json({ data: null, error: { code, message, details: err.constraint ? [{ constraint: err.constraint }] : undefined } });
    }

    logger.error('http.unhandled_error', { request_id: req.id, method: req.method, path: req.path, error: err });
    return res.status(500).json({
      data: null,
      error: { code: 'internal_error', message: 'An unexpected error occurred. Please try again.' },
    });
  };
}
