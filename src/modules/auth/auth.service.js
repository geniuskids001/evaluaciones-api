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

async function getAuthenticatedUser(idUsuario) {
  const user = await repository.findActiveUserById(idUsuario);
  if (!user || !user.activo || !user.password_hash) {
    throw new AppError(401, 'USER_NOT_ACTIVE', 'El usuario ya no tiene acceso.');
  }
  return {
    id_usuario: user.id_usuario,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    activo: Boolean(user.activo),
    last_login_at: user.last_login_at || null,
    created_at: user.created_at || null
  };
}

async function updateMyName(idUsuario, nombre) {
  await repository.updateName(idUsuario, nombre);
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

async function requestEmailChange(idUsuario, newEmail, currentPassword, requestId = null) {
  const normalizedEmail = newEmail.trim().toLowerCase();
  const user = await repository.findActiveUserById(idUsuario);
  if (!user || !user.activo || !user.password_hash) {
    throw new AppError(401, 'USER_NOT_ACTIVE', 'El usuario ya no tiene acceso.');
  }
  if (normalizedEmail === user.email.toLowerCase()) {
    throw new AppError(409, 'EMAIL_UNCHANGED', 'El nuevo correo debe ser diferente al actual.');
  }
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new AppError(401, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual es incorrecta.');
  }
  const existing = await repository.findUserByEmail(normalizedEmail);
  if (existing) {
    throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Ese correo ya está registrado.');
  }

  const connection = await pool.getConnection();
  let rawToken;
  try {
    await connection.beginTransaction();
    rawToken = await tokenRepository.issueToken(connection, {
      idUsuario,
      tipo: 'cambio_email',
      ttlMinutes: Number(process.env.AUTH_EMAIL_CHANGE_TTL_MINUTES || 60),
      payload: { new_email: normalizedEmail }
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    await mailer.sendEmailChangeConfirmation({
      email: normalizedEmail,
      nombre: user.nombre,
      token: rawToken
    });
  } catch (error) {
    await logSystemDebug({
      level: 'error', module: 'auth', action: 'change_email_email',
      errorCode: error.code || 'EMAIL_CHANGE_EMAIL_FAILED',
      message: 'No fue posible enviar la confirmación del nuevo correo.',
      requestId, idUsuario, entityType: 'usuario', entityId: idUsuario
    });
    throw new AppError(503, 'EMAIL_CHANGE_EMAIL_FAILED', 'No fue posible enviar la confirmación al nuevo correo.');
  }
}

async function confirmEmailChange(rawToken) {
  const payload = tokenRepository.readSignedPayloadToken(rawToken);
  if (!payload || !payload.sub || !payload.new_email) {
    throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'El enlace no es válido o ya expiró.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const token = await tokenRepository.lockValidToken(connection, rawToken, 'cambio_email');
    if (!token || token.id_usuario !== Number(payload.sub) || !token.activo || token.deleted_at) {
      throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'El enlace no es válido o ya expiró.');
    }
    const existing = await repository.findUserByEmailForConnection(connection, payload.new_email);
    if (existing && existing.id_usuario !== token.id_usuario) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Ese correo ya está registrado.');
    }
    await repository.updateEmail(connection, token.id_usuario, payload.new_email);
    await tokenRepository.consumeToken(connection, token.id_token_usuario);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Ese correo ya está registrado.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function requestPasswordChange(idUsuario, requestId = null) {
  const user = await repository.findActiveUserById(idUsuario);
  if (!user || !user.activo || !user.password_hash) {
    throw new AppError(401, 'USER_NOT_ACTIVE', 'El usuario ya no tiene acceso.');
  }

  const connection = await pool.getConnection();
  let rawToken;
  try {
    await connection.beginTransaction();
    rawToken = await tokenRepository.issueToken(connection, {
      idUsuario,
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
      action: 'change_password_email',
      errorCode: error.code || 'PASSWORD_CHANGE_EMAIL_FAILED',
      message: 'No fue posible enviar el correo de cambio de contraseña.',
      requestId,
      idUsuario,
      entityType: 'usuario',
      entityId: idUsuario,
      context: {
        mail_configured: mailer.mailerConfigured(),
        frontend_configured: mailer.frontendConfigured()
      }
    });
    throw new AppError(503, 'PASSWORD_CHANGE_EMAIL_FAILED', 'No fue posible enviar el correo de cambio de contraseña.');
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
  getAuthenticatedUser,
  updateMyName,
  publicUser,
  requestPasswordReset,
  requestPasswordChange,
  requestEmailChange,
  confirmEmailChange,
  activate,
  resetPassword
};
