const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repository = require('./auth.repository');
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

  // Misma respuesta para usuario inexistente, inactivo o contraseña incorrecta.
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
    { role: user.rol },
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
    user: publicUser(user)
  };
}

module.exports = { login, publicUser };
