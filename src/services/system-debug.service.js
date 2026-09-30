const pool = require('../config/db');

async function logSystemDebug({
  level = 'error',
  module = null,
  action = null,
  errorCode = null,
  message,
  requestId = null,
  idUsuario = null,
  entityType = null,
  entityId = null,
  context = null,
  stackTrace = null
}) {
  try {
    await pool.execute(
      `INSERT INTO system_debugging
        (level, module, action, error_code, message, request_id, id_usuario,
         entity_type, entity_id, context_json, stack_trace, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        level,
        module,
        action,
        errorCode,
        String(message || 'Error interno').slice(0, 65535),
        requestId,
        idUsuario,
        entityType,
        entityId,
        context ? JSON.stringify(context) : null,
        stackTrace
      ]
    );
  } catch (loggingError) {
    console.error('system_debugging write failed', {
      requestId,
      message: loggingError.message
    });
  }
}

module.exports = { logSystemDebug };
