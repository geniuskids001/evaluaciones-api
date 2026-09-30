const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const repository = require('./auth.repository');
const tokenRepository = require('./auth-token.repository');
const { capabilitiesFor } = require('./auth.permissions');
const mailer = require('../../services/mailer.service');
const { logSystemDebug } = require('../../services/system-debug.service');
const { passwordVersion } = require('../../utils/password-version');
const { AppError } = require('../../utils/app-error');

function publicUser(user) {
  return {
    id_usuario: user.id_usuario,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol
  };
}

async function login(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await repository.findActiveUserByEmail(normalizedEmail);

  if (!user || !user.activo || !user.password_hash) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos.');
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos.');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Autenticación no configurada.');
  }

  const token = jwt.sign(
    {
      role: user.rol,
      pwdv: passwordVersion(user.password_hash)
    },
    secret,
    {
      subject: String(user.id_usuario),
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      issuer: process.env.JWT_ISSUER || 'genius-quiz-api',
      algorithm: 'HS256'
    }
  );

  await repository.updateLastLogin(user.id_usuario);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: process.env.JWT_EXPIRES_IN || '8h',
    user: publicUser(user),
    capabilities: capabilitiesFor(user.rol)
  };
}

async function requestPasswordReset(email, requestId = null) {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const user = await repository.findActiveUserByEmail(normalizedEmail);

    if (!user || !user.activo || !user.password_hash) {
      return;
    }

    const connection = await pool.getConnection();
    let rawToken;

    try {
      await connection.beginTransaction();
      rawToken = await tokenRepository.issueToken(connection, {
        idUsuario: user.id_usuario,
        tipo: 'reset_password',
        ttlMinutes: Number(process.env.AUTH_RESET_TTL_MINUTES || 60)
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    try {
      await mailer.sendPasswordResetEmail({
        email: user.email,
        nombre: user.nombre,
        token: rawToken
      });
    } catch (error) {
      await logSystemDebug({
        level: 'error',
        module: 'auth',
        action: 'forgot_password_email',
        errorCode: error.code || 'PASSWORD_RESET_EMAIL_FAILED',
        message: 'No fue posible enviar el correo de recuperación.',
        requestId,
        idUsuario: user.id_usuario,
        entityType: 'usuario',
        entityId: user.id_usuario,
        context: {
          mail_configured: mailer.mailerConfigured(),
          frontend_configured: mailer.frontendConfigured()
        }
      });
    }
  } catch (error) {
    await logSystemDebug({
      level: 'error',
      module: 'auth',
      action: 'forgot_password',
      errorCode: error.code || 'PASSWORD_RESET_REQUEST_FAILED',
      message: 'No fue posible procesar internamente la solicitud de recuperación.',
      requestId
    });
  }
}

async function setPasswordFromToken(rawToken, tipo, password) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const token = await tokenRepository.lockValidToken(connection, rawToken, tipo);

    if (!token || !token.activo || token.deleted_at) {
      throw new AppError(
        400,
        'INVALID_OR_EXPIRED_TOKEN',
        'El enlace no es válido o ya expiró.'
      );
    }

    if (tipo === 'reset_password' && !token.password_hash) {
      throw new AppError(
        400,
        'INVALID_OR_EXPIRED_TOKEN',
        'El enlace no es válido o ya expiró.'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await repository.updatePassword(connection, token.id_usuario, passwordHash);

    // Al cambiar la contraseña se invalidan todos los enlaces pendientes del usuario.
    await tokenRepository.invalidateAllUserTokens(connection, token.id_usuario);

    await connection.commit();

    return {
      id_usuario: token.id_usuario,
      email: token.email
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function activate(rawToken, password) {
  return setPasswordFromToken(rawToken, 'activacion', password);
}

async function resetPassword(rawToken, password) {
  return setPasswordFromToken(rawToken, 'reset_password', password);
}

module.exports = {
  login,
  publicUser,
  requestPasswordReset,
  activate,
  resetPassword
};
