const nodemailer = require('nodemailer');
const repository = require('./sessions.repository');
const reportService = require('./result-report.service');
const { AppError } = require('../../utils/app-error');

let transporter;

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function getMailer() {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  if (required.some((key) => !process.env[key])) {
    throw new AppError(500, 'MAILER_NOT_CONFIGURED', 'El servicio de correo no está configurado.');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
      maxConnections: 1,
      maxMessages: 100
    });
  }
  return transporter;
}

async function processEmail(idSend, { retryCount = 0 } = {}) {
  const send = await repository.findEmailSendForWorker(idSend);
  if (!send) throw new AppError(404, 'EMAIL_SEND_NOT_FOUND', 'Envío no encontrado.');
  if (send.status === 'exito') return { id_envio: Number(idSend), status: 'exito', already_processed: true };

  const claimed = await repository.claimEmailSend(idSend, Number(retryCount) > 0);
  if (!claimed) {
    const current = await repository.findEmailSendForWorker(idSend);
    if (current?.status === 'exito') {
      return { id_envio: Number(idSend), status: 'exito', already_processed: true };
    }
    return { id_envio: Number(idSend), status: current?.status || 'error', already_processed: true };
  }

  try {
    const snapshot = parseJson(send.resultado_snapshot_json, {}) || {};
    const content = reportService.emailContent({
      name: send.aplicacion_nombre,
      sessionName: send.sesion_nombre,
      evaluationName: send.evaluacion_nombre,
      snapshot
    });

    const info = await getMailer().sendMail({
      from: process.env.SMTP_FROM,
      to: send.email,
      subject: content.subject,
      text: content.text,
      html: content.html
    });

    await repository.markEmailSuccess(repository.pool, idSend, info?.messageId || null);
    return { id_envio: Number(idSend), status: 'exito', email: send.email, pdf_adjunto: false };
  } catch (error) {
    await repository.markEmailError(repository.pool, idSend, error.message || 'Error al enviar correo.');
    console.error('Result email delivery failed:', Number(idSend), error.message || error);
    throw new AppError(502, 'EMAIL_SEND_FAILED', 'No fue posible enviar el correo de resultados.');
  }
}

module.exports = { processEmail };
