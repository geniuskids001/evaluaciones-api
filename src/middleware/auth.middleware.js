const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { capabilitiesFor } = require('../modules/auth/auth.permissions');
const { passwordVersion } = require('../utils/password-version');
const { AppError } = require('../utils/app-error');

async function authenticate(req, res, next) {
  try {
    const authorization = req.header('Authorization') || '';
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Autenticación requerida.');
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Autenticación no configurada.');
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
      `SELECT id_usuario, nombre, email, password_hash, rol, activo
       FROM usuarios
       WHERE id_usuario = ? AND deleted_at IS NULL
       LIMIT 1`,
      [payload.sub]
    );

    const user = rows[0];

    if (!user || !user.activo || !user.password_hash) {
      throw new AppError(401, 'USER_NOT_ACTIVE', 'El usuario ya no tiene acceso.');
    }

    // Cambiar la contraseña invalida inmediatamente JWTs emitidos con el hash anterior.
    if (!payload.pwdv || payload.pwdv !== passwordVersion(user.password_hash)) {
      throw new AppError(401, 'INVALID_TOKEN', 'La sesión no es válida o expiró.');
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

function authorizeCapability(capability) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError(401, 'AUTH_REQUIRED', 'Autenticación requerida.'));
    }

    if (!capabilitiesFor(req.user.rol).includes(capability)) {
      return next(new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción.'));
    }

    return next();
  };
}

module.exports = { authenticate, authorize, authorizeCapability };
