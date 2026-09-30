const pool = require('../../config/db');
const repository = require('./users.repository');
const tokenRepository = require('../auth/auth-token.repository');
const mailer = require('../../services/mailer.service');
const { logSystemDebug } = require('../../services/system-debug.service');
const { AppError } = require('../../utils/app-error');

function normalizeUser(row) {
  if (!row) return null;
  return {
    ...row,
    activo: Boolean(row.activo),
    activation_pending: Boolean(row.activation_pending)
  };
}

function isRemovingActiveSuperadmin(current, nextRole, nextActivo, deleting = false) {
  if (current.rol !== 'superadmin' || !current.activo || current.deleted_at) return false;
  if (deleting) return true;
  return nextRole !== 'superadmin' || !nextActivo;
}

async function assertCanRemoveSuperadmin(connection, current, nextRole, nextActivo, deleting = false) {
  if (!isRemovingActiveSuperadmin(current, nextRole, nextActivo, deleting)) return;

  const superadmins = await repository.lockActiveSuperadmins(connection);
  if (superadmins.length <= 1) {
    throw new AppError(
      409,
      'LAST_SUPERADMIN',
      'La operación dejaría al sistema sin un superadmin activo.'
    );
  }
}

async function sendActivationSafely(user, rawToken, requestId = null) {
  try {
    await mailer.sendActivationEmail({
      email: user.email,
      nombre: user.nombre,
      token: rawToken
    });
    return true;
  } catch (error) {
    await logSystemDebug({
      level: 'error',
      module: 'users',
      action: 'send_activation_email',
      errorCode: error.code || 'ACTIVATION_EMAIL_FAILED',
      message: 'No fue posible enviar el correo de activación.',
      requestId,
      idUsuario: user.id_usuario,
      entityType: 'usuario',
      entityId: user.id_usuario,
      context: { mail_configured: mailer.mailerConfigured(), frontend_configured: mailer.frontendConfigured() }
    });
    return false;
  }
}

async function listUsers(search) {
  const rows = await repository.listUsers(search);
  return rows.map(normalizeUser);
}

async function getUser(idUsuario) {
  const user = await repository.findUserById(idUsuario);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  return normalizeUser(user);
}

async function createUser(input, requestId = null) {
  const connection = await pool.getConnection();
  let rawToken;
  let idUsuario;

  try {
    await connection.beginTransaction();

    idUsuario = await repository.createUser(connection, input);
    rawToken = await tokenRepository.issueToken(connection, {
      idUsuario,
      tipo: 'activacion',
      ttlMinutes: Number(process.env.AUTH_ACTIVATION_TTL_MINUTES || 1440)
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'USER_EMAIL_EXISTS', 'Ya existe un usuario con ese email.');
    }
    throw error;
  } finally {
    connection.release();
  }

  const user = await getUser(idUsuario);
  const activationEmailSent = await sendActivationSafely(user, rawToken, requestId);

  return { user, activation_email_sent: activationEmailSent };
}

async function updateUser(idUsuario, input, requestId = null) {
  const connection = await pool.getConnection();
  let shouldSendActivation = false;
  let rawToken = null;

  try {
    await connection.beginTransaction();

    const current = await repository.lockUserById(connection, idUsuario);
    if (!current || current.deleted_at) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    }

    const nextRole = input.rol ?? current.rol;
    const nextActivo = input.activo ?? Boolean(current.activo);

    await assertCanRemoveSuperadmin(connection, current, nextRole, nextActivo);

    const changes = {};
    if (input.nombre !== undefined) changes.nombre = input.nombre;
    if (input.email !== undefined) changes.email = input.email;
    if (input.rol !== undefined) changes.rol = input.rol;
    if (input.activo !== undefined) changes.activo = input.activo ? 1 : 0;

    await repository.updateUser(connection, idUsuario, changes);

    const reactivated = input.activo === true && !current.activo;

    if (!nextActivo) {
      await tokenRepository.invalidateAllUserTokens(connection, idUsuario);
    } else if (current.password_hash === null && (emailChanged || reactivated)) {
      rawToken = await tokenRepository.issueToken(connection, {
        idUsuario,
        tipo: 'activacion',
        ttlMinutes: Number(process.env.AUTH_ACTIVATION_TTL_MINUTES || 1440)
      });
      shouldSendActivation = true;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'USER_EMAIL_EXISTS', 'Ya existe un usuario con ese email.');
    }
    throw error;
  } finally {
    connection.release();
  }

  const user = await getUser(idUsuario);
  let activationEmailSent = null;
  if (shouldSendActivation) {
    activationEmailSent = await sendActivationSafely(user, rawToken, requestId);
  }

  return { user, activation_email_sent: activationEmailSent };
}

async function deleteUser(idUsuario, deletedBy) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const current = await repository.lockUserById(connection, idUsuario);
    if (!current || current.deleted_at) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    }

    await assertCanRemoveSuperadmin(
      connection,
      current,
      current.rol,
      Boolean(current.activo),
      true
    );

    await repository.softDeleteUser(connection, idUsuario, deletedBy);
    await tokenRepository.invalidateAllUserTokens(connection, idUsuario);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function resendActivation(idUsuario, requestId = null) {
  const connection = await pool.getConnection();
  let rawToken;
  let user;

  try {
    await connection.beginTransaction();

    const current = await repository.lockUserById(connection, idUsuario);
    if (!current || current.deleted_at) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    }
    if (!current.activo) {
      throw new AppError(409, 'USER_INACTIVE', 'El usuario está inactivo.');
    }
    if (current.password_hash) {
      throw new AppError(409, 'USER_ALREADY_ACTIVATED', 'El usuario ya tiene contraseña.');
    }

    rawToken = await tokenRepository.issueToken(connection, {
      idUsuario,
      tipo: 'activacion',
      ttlMinutes: Number(process.env.AUTH_ACTIVATION_TTL_MINUTES || 1440)
    });

    await connection.commit();
    user = await getUser(idUsuario);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const sent = await sendActivationSafely(user, rawToken, requestId);
  if (!sent) {
    throw new AppError(503, 'ACTIVATION_EMAIL_FAILED', 'No fue posible enviar el correo de activación.');
  }

  return { sent: true };
}

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  resendActivation
};
