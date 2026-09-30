const pool = require('../config/db');
const { AppError } = require('../utils/app-error');

function safeContext(req) {
  return {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  };
}

async function persistDebug(error, req) {
  try {
    await pool.execute(
      `INSERT INTO system_debugging
        (level, module, action, error_code, message, request_id, id_usuario,
         entity_type, entity_id, context_json, stack_trace, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        error.statusCode >= 500 ? 'error' : 'warning',
        error.module || 'http',
        error.action || req.method,
        error.code || 'INTERNAL_ERROR',
        String(error.message || 'Error interno').slice(0, 65535),
        req.requestId || null,
        req.user?.id_usuario || null,
        error.entityType || null,
        error.entityId || null,
        JSON.stringify(safeContext(req)),
        process.env.NODE_ENV === 'production' ? null : error.stack || null
      ]
    );
  } catch (loggingError) {
    console.error('system_debugging write failed', {
      requestId: req.requestId,
      message: loggingError.message
    });
  }
}

function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Recurso no encontrado.'));
}

async function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const publicMessage =
    error instanceof AppError ? error.message : 'Ocurrió un error interno.';

  if (statusCode >= 500) {
    console.error(error);
  }

  await persistDebug({ ...error, statusCode }, req);

  res.status(statusCode).json({
    ok: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: publicMessage,
      request_id: req.requestId
    }
  });
}

module.exports = { notFound, errorHandler };
