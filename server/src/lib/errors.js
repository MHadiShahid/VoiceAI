// Typed application errors. The HTTP error middleware maps these to status
// codes; the voice tool layer maps them to caller-friendly messages.

export class AppError extends Error {
  constructor(message, { status = 500, code = 'internal_error', details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Malformed request (bad JSON, bad UUID, bad query param). */
export class BadRequestError extends AppError {
  constructor(message, details) {
    super(message, { status: 400, code: 'bad_request', details });
  }
}

/** Well-formed request whose field values fail validation. */
export class ValidationError extends AppError {
  /** @param {{field: string, message: string}[]} errors */
  constructor(errors, message = 'One or more fields are invalid.') {
    super(message, { status: 422, code: 'validation_error', details: errors });
    this.errors = errors;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(message, { status: 404, code: 'not_found' });
  }
}

export class ConflictError extends AppError {
  constructor(message, details) {
    super(message, { status: 409, code: 'conflict', details });
  }
}
