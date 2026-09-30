const nodemailer = require('nodemailer');
const { AppError } = require('../utils/app-error');

function mailerConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

function frontendConfigured() {
  return Boolean(process.env.FRONTEND_URL);
}

function createTransporter() {
  if (!mailerConfigured()) {
    throw new AppError(500, 'MAILER_NOT_CONFIGURED', 'El servicio de correo no está configurado.');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function buildFrontendLink(path, token) {
  if (!frontendConfigured()) {
    throw new AppError(500, 'FRONTEND_URL_NOT_CONFIGURED', 'La URL del frontend no está configurada.');
  }

  const base = process.env.FRONTEND_URL.endsWith('/')
    ? process.env.FRONTEND_URL
    : `${process.env.FRONTEND_URL}/`;

  const url = new URL(path.replace(/^\//, ''), base);
  url.searchParams.set('token', token);
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendActivationEmail({ email, nombre, token }) {
  const link = buildFrontendLink('/activate', token);
  const transporter = createTransporter();

  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Activa tu acceso a Genius Quiz',
    text:
      `Hola ${nombre}.\n\nSe creó tu acceso a Genius Quiz.\n` +
      `Establece tu contraseña aquí: ${link}\n\n` +
      'Si no esperabas este correo, puedes ignorarlo.',
    html:
      `<p>Hola ${escapeHtml(nombre)}.</p>` +
      '<p>Se creó tu acceso a <strong>Genius Quiz</strong>.</p>' +
      `<p><a href="${escapeHtml(link)}">Establecer contraseña</a></p>` +
      '<p>Si no esperabas este correo, puedes ignorarlo.</p>'
  });
}

async function sendEmailChangeConfirmation({ email, nombre, token }) {
  const link = buildFrontendLink('/confirm-email-change', token);
  const transporter = createTransporter();
  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Confirma tu nuevo correo de Genius Quiz',
    text: `Hola ${nombre}.\n\nSolicitaste cambiar tu correo de Genius Quiz. Confirma el nuevo correo aquí: ${link}\n\nTu correo actual no cambiará hasta confirmar este enlace.`,
    html: `<p>Hola ${escapeHtml(nombre)}.</p><p>Solicitaste cambiar tu correo de <strong>Genius Quiz</strong>.</p><p><a href="${escapeHtml(link)}">Confirmar nuevo correo</a></p><p>Tu correo actual no cambiará hasta confirmar este enlace.</p>`
  });
}

async function sendPasswordResetEmail({ email, nombre, token }) {
  const link = buildFrontendLink('/reset-password', token);
  const transporter = createTransporter();

  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Restablece tu contraseña de Genius Quiz',
    text:
      `Hola ${nombre}.\n\nRecibimos una solicitud para restablecer tu contraseña.\n` +
      `Crea una nueva contraseña aquí: ${link}\n\n` +
      'Si no solicitaste este cambio, puedes ignorar este correo.',
    html:
      `<p>Hola ${escapeHtml(nombre)}.</p>` +
      '<p>Recibimos una solicitud para restablecer tu contraseña de <strong>Genius Quiz</strong>.</p>' +
      `<p><a href="${escapeHtml(link)}">Restablecer contraseña</a></p>` +
      '<p>Si no solicitaste este cambio, puedes ignorar este correo.</p>'
  });
}

module.exports = {
  mailerConfigured,
  frontendConfigured,
  sendActivationEmail,
  sendPasswordResetEmail,
  sendEmailChangeConfirmation
};
