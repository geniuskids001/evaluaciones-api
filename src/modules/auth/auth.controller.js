const authService = require('./auth.service');
const { AppError } = require('../../utils/app-error');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    data: { user: req.user }
  });
}

module.exports = { login, me };
