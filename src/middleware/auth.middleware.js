const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { AppError } = require('../utils/app-error');

async function authenticate(req, res, next) {
  try {
    const authorization = req.header('Authorization') || '';
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Autenticación requerida.');
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'genius-quiz-api'
      });
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'La sesión no es válida o expiró.');
    }

    const [rows] = await pool.execute(
      `SELECT id_usuario, nombre, email, rol, activo
       FROM usuarios
       WHERE id_usuario = ? AND deleted_at IS NULL
       LIMIT 1`,
      [payload.sub]
    );

    const user = rows[0];

    if (!user || !user.activo) {
      throw new AppError(401, 'USER_NOT_ACTIVE', 'El usuario ya no tiene acceso.');
    }

    req.user = {
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol
    };

    next();
  } catch (error) {
    next(error);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError(401, 'AUTH_REQUIRED', 'Autenticación requerida.'));
    }

    if (!roles.includes(req.user.rol)) {
      return next(new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción.'));
    }

    return next();
  };
}

module.exports = { authenticate, authorize };
