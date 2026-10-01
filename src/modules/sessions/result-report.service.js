const jwt = require('jsonwebtoken');
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

function computePrimaryDimensions(dimensions) {
  const values = (Array.isArray(dimensions) ? dimensions : [])
    .map((dimension) => ({
      ...dimension,
      score: Number(dimension.valor)
    }))
    .filter((dimension) => Number.isFinite(dimension.score));

  if (!values.length) return [];
  const highest = Math.max(...values.map((dimension) => dimension.score));
  return values
    .filter((dimension) => Math.abs(dimension.score - highest) < 0.000001)
    .map((dimension) => ({
      id_dimension: Number(dimension.id_dimension),
      nombre: dimension.nombre,
      color: dimension.color || null,
      valor: dimension.score,
      porcentaje: Number(dimension.porcentaje || 0)
    }));
}

function emailContent({ name, sessionName, evaluationName, snapshot }) {
  const safeName = String(name || '');
  const safeSessionName = String(sessionName || '');
  const safeEvaluationName = String(evaluationName || '');
  const score = snapshot.puntaje_maximo > 0
    ? String(snapshot.puntaje_correctas) + ' / ' + String(snapshot.puntaje_maximo)
    : null;
  const percentage = snapshot.porcentaje_correctas === null || snapshot.porcentaje_correctas === undefined
    ? null
    : Number(snapshot.porcentaje_correctas);
  const dimensions = Array.isArray(snapshot.dimensiones) ? snapshot.dimensiones : [];
  const primaryDimensions = Array.isArray(snapshot.dimensiones_principales) && snapshot.dimensiones_principales.length
    ? snapshot.dimensiones_principales
    : computePrimaryDimensions(dimensions);
  const primaryNames = primaryDimensions.map((d) => escapeHtml(d.nombre)).join(', ');
  const primaryTitle = primaryDimensions.length === 1
    ? 'Dimensión principal'
    : 'Dimensiones principales';

  const dimensionRows = dimensions.map((dimension) => {
    const color = /^#[0-9a-f]{6}$/i.test(String(dimension.color || '')) ? dimension.color : '#7AA7B8';
    const value = Number(dimension.porcentaje);
    const percentageValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    const label = Number.isFinite(value) ? value : 0;
    return '<tr>' +
      '<td style="padding:10px 0 4px;font-size:14px;font-weight:700;color:#1A2F56;">' +
        '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + color + ';margin-right:8px;"></span>' +
        escapeHtml(dimension.nombre) +
      '</td>' +
      '<td style="padding:10px 0 4px;text-align:right;font-size:13px;font-weight:700;color:#1A2F56;">' + escapeHtml(label) + '%</td>' +
      '</tr>' +
      '<tr><td colspan="2" style="padding:0 0 8px;border-bottom:1px solid #E7EEF2;">' +
        '<div style="height:9px;border-radius:8px;background:#EAF0F3;overflow:hidden;">' +
          '<div style="height:9px;width:' + percentageValue + '%;background:' + color + ';border-radius:8px;"></div>' +
        '</div>' +
      '</td></tr>';
  }).join('');

  const scoreBlock = score
    ? '<div style="margin:18px 0;padding:18px;border-radius:18px;background:#F2F7FA;text-align:center;">' +
        '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5D7D8A;font-weight:700;">Puntaje</div>' +
        '<div style="margin-top:6px;font-size:32px;line-height:1;font-weight:800;color:#1A2F56;">' + escapeHtml(score) + '</div>' +
        (percentage !== null ? '<div style="margin-top:6px;font-size:14px;color:#5D7D8A;">' + escapeHtml(percentage) + '%</div>' : '') +
      '</div>'
    : '';

  const primaryBlock = primaryDimensions.length
    ? '<div style="margin:20px 0 12px;padding:16px 18px;border-left:5px solid #D0B539;border-radius:12px;background:#FFF9DF;">' +
        '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#665A1E;font-weight:800;">' + primaryTitle + '</div>' +
        '<div style="margin-top:5px;font-size:22px;line-height:1.25;font-weight:800;color:#1A2F56;">' + primaryNames + '</div>' +
      '</div>'
    : '';

  const dimensionsBlock = dimensions.length
    ? '<div style="margin-top:22px;">' +
        '<div style="font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5D7D8A;">Resultados por dimensión</div>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px;border-collapse:collapse;">' +
          dimensionRows +
        '</table>' +
      '</div>'
    : '';

  const sessionLabel = safeSessionName ? ' (' + safeSessionName + ')' : '';
  return {
    subject: 'Tus resultados de ' + safeEvaluationName + ' · Genius Quiz',
    text: 'Hola ' + safeName + '.\n\nTus resultados de ' + safeEvaluationName + sessionLabel + ' están listos.' +
      (score ? '\n\nPuntaje: ' + score : '') +
      (primaryDimensions.length ? '\n\n' + primaryTitle + ': ' + primaryDimensions.map((d) => d.nombre).join(', ') : '') +
      (dimensions.length ? '\n\nResultados por dimensión:\n' + dimensions.map((d) => '- ' + d.nombre + ': ' + (d.porcentaje ?? 0) + '%').join('\n') : '') +
      '\n\nGenius Quiz',
    html: '<div style="margin:0;padding:28px 14px;background:#F3F8FA;font-family:Arial,Helvetica,sans-serif;color:#1A2F56;">' +
      '<div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E7EEF2;border-radius:24px;overflow:hidden;">' +
        '<div style="padding:26px 28px;background:linear-gradient(135deg,#1A2F56,#24466F);color:#FFFFFF;">' +
          '<div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#D0B539;">Genius Quiz</div>' +
          '<h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;">Tus resultados están listos</h1>' +
        '</div>' +
        '<div style="padding:26px 28px;">' +
          '<p style="margin:0;font-size:16px;">Hola <strong>' + escapeHtml(safeName) + '</strong>.</p>' +
          '<p style="margin:10px 0 0;line-height:1.6;color:#526577;">Este es tu resultado de <strong style="color:#1A2F56;">' +
            escapeHtml(safeEvaluationName) + '</strong>' +
            (safeSessionName ? ' en ' + escapeHtml(safeSessionName) : '') + '.</p>' +
          scoreBlock +
          primaryBlock +
          dimensionsBlock +
          '<p style="margin:24px 0 0;font-size:12px;color:#7A8B99;">Genius Quiz · Resultados de evaluación</p>' +
        '</div>' +
      '</div>' +
    '</div>'
  };
}

module.exports = {
  createResultReportToken,
  readResultReportToken,
  computePrimaryDimensions,
  emailContent
};
