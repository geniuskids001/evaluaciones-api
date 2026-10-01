const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');
const { AppError } = require('../../utils/app-error');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createResultReportToken(idSession, idApplication) {
  if (!process.env.JWT_SECRET) {
    throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Autenticación no configurada.');
  }
  return jwt.sign(
    { purpose: 'result_report', sid: Number(idSession), aid: Number(idApplication) },
    process.env.JWT_SECRET,
    {
      expiresIn: '10m',
      issuer: process.env.JWT_ISSUER || 'genius-quiz-api',
      audience: 'genius-quiz-result-report',
      algorithm: 'HS256'
    }
  );
}

function readResultReportToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'genius-quiz-api',
      audience: 'genius-quiz-result-report'
    });
    if (payload?.purpose !== 'result_report') return null;
    const idSession = Number(payload.sid);
    const idApplication = Number(payload.aid);
    if (!Number.isInteger(idSession) || !Number.isInteger(idApplication)) return null;
    return { idSession, idApplication };
  } catch {
    return null;
  }
}

function resultReportUrl(token) {
  const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (!base) {
    throw new AppError(500, 'FRONTEND_URL_NOT_CONFIGURED', 'La URL del frontend no está configurada.');
  }
  return `${base}/report/${encodeURIComponent(token)}?pdf=1`;
}

async function renderResultPdf(idSession, idApplication) {
  const reportToken = createResultReportToken(idSession, idApplication);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(resultReportUrl(reportToken), { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('[data-report-ready="true"]', { timeout: 15000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }
    });
  } finally {
    await browser.close();
  }
}

function emailContent({ name, sessionName, evaluationName, snapshot, includePdf = true }) {
  const score = snapshot.puntaje_maximo > 0
    ? `${snapshot.puntaje_correctas} / ${snapshot.puntaje_maximo}`
    : null;
  const percentage = snapshot.porcentaje_correctas === null || snapshot.porcentaje_correctas === undefined
    ? null
    : Number(snapshot.porcentaje_correctas);
  const dimensions = Array.isArray(snapshot.dimensiones) ? snapshot.dimensiones : [];

  const dimensionText = dimensions.length
    ? `\n\nResultados por dimensión:\n${dimensions.map((d) => `- ${d.nombre}: ${d.porcentaje ?? 0}%`).join('\n')}`
    : '';

  const dimensionRows = dimensions.map((d) => {
    const color = /^#[0-9a-f]{6}$/i.test(String(d.color || '')) ? d.color : '#7AA7B8';
    return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #E7EEF2;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escapeHtml(color)};margin-right:8px;"></span>
          <strong style="color:#1A2F56;">${escapeHtml(d.nombre)}</strong>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #E7EEF2;text-align:right;font-weight:700;color:#1A2F56;">
          ${escapeHtml(d.porcentaje ?? 0)}%
        </td>
      </tr>`;
  }).join('');

  const scoreBlock = score
    ? `<div style="margin:18px 0;padding:18px;border-radius:18px;background:#F2F7FA;text-align:center;">
         <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5D7D8A;font-weight:700;">Puntaje</div>
         <div style="margin-top:6px;font-size:32px;line-height:1;font-weight:800;color:#1A2F56;">${escapeHtml(score)}</div>
         ${percentage !== null ? `<div style="margin-top:6px;font-size:14px;color:#5D7D8A;">${escapeHtml(percentage)}%</div>` : ''}
       </div>`
    : '';

  return {
    subject: `Tus resultados de ${evaluationName} · Genius Quiz`,
    text: `Hola ${name}.\n\nTus resultados de ${evaluationName}${sessionName ? ` (${sessionName})` : ''} están listos.${score ? `\n\nPuntaje: ${score}` : ''}${dimensionText}${includePdf ? '\n\nAdjuntamos un PDF con el reporte visual completo.' : ''}\n\nGenius Quiz`,
    html: `
      <div style="margin:0;padding:28px 14px;background:#F3F8FA;font-family:Arial,Helvetica,sans-serif;color:#1A2F56;">
        <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E7EEF2;border-radius:24px;overflow:hidden;">
          <div style="padding:26px 28px;background:linear-gradient(135deg,#1A2F56,#24466F);color:#FFFFFF;">
            <div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#D0B539;">Genius Quiz</div>
            <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;">Tus resultados están listos</h1>
          </div>
          <div style="padding:26px 28px;">
            <p style="margin:0;font-size:16px;">Hola <strong>${escapeHtml(name)}</strong>.</p>
            <p style="margin:10px 0 0;line-height:1.6;color:#526577;">
              Este es tu resultado de <strong style="color:#1A2F56;">${escapeHtml(evaluationName)}</strong>${sessionName ? ` en ${escapeHtml(sessionName)}` : ''}.
            </p>
            ${scoreBlock}
            ${dimensions.length ? `
              <div style="margin-top:22px;">
                <div style="font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5D7D8A;">Dimensiones</div>
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px;border-collapse:collapse;">
                  ${dimensionRows}
                </table>
              </div>` : ''}
            ${includePdf ? `<div style="margin-top:22px;padding:14px 16px;border-radius:16px;background:#FFF9DF;color:#665A1E;font-size:13px;line-height:1.5;">
              Adjuntamos un PDF con el reporte visual completo para que puedas conservarlo o compartirlo.
            </div>` : ''}
            <p style="margin:24px 0 0;font-size:12px;color:#7A8B99;">Genius Quiz · Resultados de evaluación</p>
          </div>
        </div>
      </div>`
  };
}

module.exports = {
  createResultReportToken,
  readResultReportToken,
  renderResultPdf,
  emailContent
};
