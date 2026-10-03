const repository = require('./trash.repository');
const { capabilitiesFor } = require('../auth/auth.permissions');
const { AppError } = require('../../utils/app-error');

const RETENTION_DAYS = 30;

function capabilities(user) {
  return capabilitiesFor(user?.rol);
}

function canManageAny(user) {
  return capabilities(user).includes('papelera:manage:any');
}

function canManageOwn(user) {
  const caps = capabilities(user);
  return caps.includes('papelera:manage:any') || caps.includes('papelera:manage:own');
}

function assertTrashAccess(user) {
  if (!canManageOwn(user)) throw new AppError(403, 'FORBIDDEN', 'No tienes acceso a la papelera.');
}

function requireSuperadmin(user) {
  if (!canManageAny(user)) {
    throw new AppError(403, 'FORBIDDEN', 'Solo un superadministrador puede administrar evaluaciones y versiones eliminadas.');
  }
}

function withRetention(row) {
  const deletedAt = row.deleted_at ? new Date(row.deleted_at) : null;
  const expiresAt = deletedAt
    ? new Date(deletedAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000)
    : null;
  const remaining = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : RETENTION_DAYS;
  return {
    ...row,
    can_restore: row.can_restore === undefined ? true : Boolean(row.can_restore),
    dias_restantes: remaining,
    expires_at: expiresAt ? expiresAt.toISOString() : null
  };
}

async function list(user) {
  assertTrashAccess(user);
  const data = await repository.listTrash({
    userId: user.id_usuario,
    all: canManageAny(user)
  });
  return {
    evaluaciones: data.evaluations.map(withRetention),
    versiones: data.versions.map(withRetention),
    sesiones: data.sessions.map(withRetention)
  };
}

function assertConfirmation(value) {
  if (String(value || '').trim().toUpperCase() !== 'ELIMINAR') {
    throw new AppError(400, 'DELETE_CONFIRMATION_REQUIRED', 'Escribe ELIMINAR para confirmar esta acción.');
  }
}

async function restoreEvaluation(id, user) {
  requireSuperadmin(user);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await repository.findEvaluation(id, connection, true);
    if (!item || !item.deleted_at) throw new AppError(404, 'TRASH_ITEM_NOT_FOUND', 'La evaluación no está en la papelera.');
    await repository.restoreEvaluation(connection, id);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function restoreVersion(id, user) {
  requireSuperadmin(user);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await repository.findVersion(id, connection, true);
    if (!item || !item.deleted_at) throw new AppError(404, 'TRASH_ITEM_NOT_FOUND', 'La versión no está eliminada directamente.');
    if (item.evaluacion_deleted_at) {
      throw new AppError(409, 'PARENT_DELETED', 'Restaura primero la evaluación que contiene esta versión.');
    }
    await repository.restoreVersion(connection, id);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function restoreSession(id, user) {
  assertTrashAccess(user);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await repository.findSession(id, connection, true);
    if (!item || !item.deleted_at) throw new AppError(404, 'TRASH_ITEM_NOT_FOUND', 'La sesión no está eliminada directamente.');
    if (!canManageAny(user) && Number(item.created_by) !== Number(user.id_usuario)) {
      throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para restaurar esta sesión.');
    }
    if (item.version_deleted_at || item.evaluacion_deleted_at) {
      throw new AppError(409, 'PARENT_DELETED', 'Restaura primero la evaluación o versión que contiene esta sesión.');
    }
    await repository.restoreSession(connection, id);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function purgeEvaluation(id, confirmation, user) {
  requireSuperadmin(user);
  assertConfirmation(confirmation);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await repository.findEvaluation(id, connection, true);
    if (!item || !item.deleted_at) throw new AppError(404, 'TRASH_ITEM_NOT_FOUND', 'La evaluación no está en la papelera.');
    await repository.purgeEvaluation(connection, id);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function purgeVersion(id, confirmation, user) {
  requireSuperadmin(user);
  assertConfirmation(confirmation);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await repository.findVersion(id, connection, true);
    if (!item || (!item.deleted_at && !item.evaluacion_deleted_at)) {
      throw new AppError(404, 'TRASH_ITEM_NOT_FOUND', 'La versión no está en la papelera.');
    }
    await repository.purgeVersion(connection, id);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function purgeSession(id, user) {
  assertTrashAccess(user);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await repository.findSession(id, connection, true);
    if (!item || (!item.deleted_at && !item.version_deleted_at && !item.evaluacion_deleted_at)) {
      throw new AppError(404, 'TRASH_ITEM_NOT_FOUND', 'La sesión no está en la papelera.');
    }
    if (!canManageAny(user) && Number(item.created_by) !== Number(user.id_usuario)) {
      throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para eliminar definitivamente esta sesión.');
    }
    await repository.purgeSession(connection, id);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  list,
  restoreEvaluation,
  restoreVersion,
  restoreSession,
  purgeEvaluation,
  purgeVersion,
  purgeSession
};
