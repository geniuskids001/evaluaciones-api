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
  forgotPassword,
  activate,
  resetPassword
};
