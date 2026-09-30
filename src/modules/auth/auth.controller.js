const authService = require('./auth.service');
const { capabilitiesFor } = require('./auth.permissions');
const { AppError } = require('../../utils/app-error');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(
      400,
      'INVALID_PASSWORD',
      'La contraseña debe tener entre 8 y 128 caracteres.'
    );
  }
  return password;
}

function validateToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 500) {
    throw new AppError(400, 'INVALID_TOKEN', 'El enlace no es válido o ya expiró.');
  }
  return token;
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || !EMAIL_RE.test(email) ||
        typeof password !== 'string' || password.length === 0) {
      throw new AppError(400, 'INVALID_LOGIN_PAYLOAD', 'Email y contraseña son requeridos.');
    }

    const result = await authService.login(email, password);
    res.status(200).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

function me(req, res) {
  res.status(200).json({
    ok: true,
    data: {
      user: req.user,
      capabilities: capabilitiesFor(req.user.rol)
    }
  });
}

async function updateMyProfile(req, res, next) {
  try {
    const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
    if (!nombre || nombre.length > 150) {
      throw new AppError(400, 'INVALID_USER_NAME', 'El nombre no es válido.');
    }
    await authService.updateMyName(req.user.id_usuario, nombre);
    const user = await authService.getAuthenticatedUser(req.user.id_usuario);
    res.status(200).json({ ok: true, data: { user } });
  } catch (error) { next(error); }
}

async function forgotPassword(req, res, next) {
  try {
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new AppError(400, 'INVALID_EMAIL', 'El email no es válido.');
    }

    await authService.requestPasswordReset(email, req.requestId);

    res.status(200).json({
      ok: true,
      data: {
        message: 'Si el correo corresponde a un usuario activo, recibirás un enlace para restablecer la contraseña.'
      }
    });
  } catch (error) {
    next(error);
  }
}

async function requestPasswordChange(req, res, next) {
  try {
    await authService.requestPasswordChange(req.user.id_usuario, req.requestId);
    res.status(200).json({
      ok: true,
      data: { message: 'Se envió un enlace para cambiar tu contraseña al correo de tu cuenta.' }
    });
  } catch (error) { next(error); }
}

async function requestEmailChange(req, res, next) {
  try {
    const newEmail = typeof req.body?.new_email === 'string' ? req.body.new_email.trim().toLowerCase() : '';
    const currentPassword = req.body?.current_password;
    if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) {
      throw new AppError(400, 'INVALID_EMAIL', 'El email no es válido.');
    }
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      throw new AppError(400, 'CURRENT_PASSWORD_REQUIRED', 'La contraseña actual es requerida.');
    }
    await authService.requestEmailChange(req.user.id_usuario, newEmail, currentPassword, req.requestId);
    res.status(200).json({ ok: true, data: { message: 'Se envió un enlace de confirmación al nuevo correo.' } });
  } catch (error) { next(error); }
}

async function confirmEmailChange(req, res, next) {
  try {
    const token = validateToken(req.body?.token);
    await authService.confirmEmailChange(token);
    res.status(200).json({ ok: true, data: { message: 'El nuevo correo fue confirmado correctamente.' } });
  } catch (error) { next(error); }
}

async function activate(req, res, next) {
  try {
    const token = validateToken(req.body?.token);
    const password = validatePassword(req.body?.password);

    await authService.activate(token, password);

    res.status(200).json({
      ok: true,
      data: {
        message: 'Tu cuenta fue activada. Ya puedes iniciar sesión.'
      }
    });
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const token = validateToken(req.body?.token);
    const password = validatePassword(req.body?.password);

    await authService.resetPassword(token, password);

    res.status(200).json({
      ok: true,
      data: {
        message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.'
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  me,
  updateMyProfile,
  forgotPassword,
  requestPasswordChange,
  requestEmailChange,
  confirmEmailChange,
  activate,
  resetPassword
};
