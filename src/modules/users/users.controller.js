const service = require('./users.service');
const { AppError } = require('../../utils/app-error');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(['superadmin', 'admin']);

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'INVALID_USER_ID', 'El id de usuario no es válido.');
  }
  return id;
}

function normalizeCreateBody(body = {}) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const rol = body.rol;

  if (!nombre || nombre.length > 150) {
    throw new AppError(400, 'INVALID_USER_NAME', 'El nombre es requerido y debe tener máximo 150 caracteres.');
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new AppError(400, 'INVALID_USER_EMAIL', 'El email no es válido.');
  }
  if (!VALID_ROLES.has(rol)) {
    throw new AppError(400, 'INVALID_USER_ROLE', 'El rol debe ser superadmin o admin.');
  }

  return { nombre, email, rol };
}

function normalizePatchBody(body = {}) {
  const allowed = ['nombre', 'email', 'rol', 'activo'];
  const provided = Object.keys(body);

  if (provided.length === 0 || provided.some((key) => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_USER_UPDATE', 'No hay cambios válidos para aplicar.');
  }

  const result = {};

  if (body.nombre !== undefined) {
    if (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.trim().length > 150) {
      throw new AppError(400, 'INVALID_USER_NAME', 'El nombre no es válido.');
    }
    result.nombre = body.nombre.trim();
  }

  if (body.email !== undefined) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new AppError(400, 'INVALID_USER_EMAIL', 'El email no es válido.');
    }
    result.email = email;
  }

  if (body.rol !== undefined) {
    if (!VALID_ROLES.has(body.rol)) {
      throw new AppError(400, 'INVALID_USER_ROLE', 'El rol debe ser superadmin o admin.');
    }
    result.rol = body.rol;
  }

  if (body.activo !== undefined) {
    if (typeof body.activo !== 'boolean') {
      throw new AppError(400, 'INVALID_USER_STATUS', 'activo debe ser boolean.');
    }
    result.activo = body.activo;
  }

  return result;
}

async function list(req, res, next) {
  try {
    const users = await service.listUsers(String(req.query.search || ''));
    res.status(200).json({ ok: true, data: { users } });
  } catch (error) {
    next(error);
  }
}

async function get(req, res, next) {
  try {
    const user = await service.getUser(parseId(req.params.id));
    res.status(200).json({ ok: true, data: { user } });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const result = await service.createUser(normalizeCreateBody(req.body), req.requestId);
    res.status(201).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const result = await service.updateUser(
      parseId(req.params.id),
      normalizePatchBody(req.body),
      req.requestId
    );
    res.status(200).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    await service.deleteUser(parseId(req.params.id), req.user.id_usuario);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

async function resendActivation(req, res, next) {
  try {
    const result = await service.resendActivation(parseId(req.params.id), req.requestId);
    res.status(200).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, get, create, update, remove, resendActivation };
