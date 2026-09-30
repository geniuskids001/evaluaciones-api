const { AppError } = require('../utils/app-error');
const { logSystemDebug } = require('../services/system-debug.service');

function safeContext(req) {
  return {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  };
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

  await logSystemDebug({
    level: statusCode >= 500 ? 'error' : 'warning',
    module: error.module || 'http',
    action: error.action || req.method,
    errorCode: error.code || 'INTERNAL_ERROR',
    message: error.message || 'Error interno',
    requestId: req.requestId || null,
    idUsuario: req.user?.id_usuario || null,
    entityType: error.entityType || null,
    entityId: error.entityId || null,
    context: safeContext(req),
    stackTrace: process.env.NODE_ENV === 'production' ? null : error.stack || null
  });

  const payload = {
    code: error.code || 'INTERNAL_ERROR',
    message: publicMessage,
    request_id: req.requestId
  };

  if (error instanceof AppError && Array.isArray(error.details)) {
    payload.details = error.details;
  }

  res.status(statusCode).json({ ok: false, error: payload });
}

module.exports = { notFound, errorHandler };
