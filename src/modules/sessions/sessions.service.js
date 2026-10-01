const crypto = require('crypto');
const nodemailer = require('nodemailer');
const repository = require('./sessions.repository');
const { capabilitiesFor } = require('../auth/auth.permissions');
const { AppError } = require('../../utils/app-error');

const VALID_SESSION_TYPES = new Set(['individual', 'guiada']);
const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'America/Mexico_City';
const DEFAULT_CONFIG = Object.freeze({
  permitir_regresar: true,
  mostrar_resultados: true,
  permitir_reinicio: false
});

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new AppError(400, 'INVALID_BOOLEAN', 'Se esperaba un valor booleano.');
  return value;
}

function cleanString(value, { required = false, max = 255, code = 'INVALID_TEXT', message = 'El texto no es válido.' } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new AppError(400, code, message);
    return null;
  }
  if (typeof value !== 'string') throw new AppError(400, code, message);
  const text = value.trim();
  if (required && !text) throw new AppError(400, code, message);
  if (text.length > max) throw new AppError(400, code, message);
  return text || null;
}

function parsePositiveId(value, code, message) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, code, message);
  return id;
}

function validateTimezone(timezone) {
  const tz = cleanString(timezone || DEFAULT_TIMEZONE, {
    required: true,
    max: 100,
    code: 'INVALID_TIMEZONE',
    message: 'La zona horaria no es válida.'
  });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    throw new AppError(400, 'INVALID_TIMEZONE', 'La zona horaria IANA no es válida.');
  }
  return tz;
}

function formatUtcMysql(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function utcIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return `${text.replace(' ', 'T')}Z`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timezoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}

function timezoneOffsetMs(date, timeZone) {
  const p = timezoneParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function localDateTimeToUtc(value, timeZone) {
  const match = String(value).trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0)
  };
  const localAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second
  );
  let probe = new Date(localAsUtc);
  let offset = timezoneOffsetMs(probe, timeZone);
  let result = new Date(localAsUtc - offset);
  const secondOffset = timezoneOffsetMs(result, timeZone);
  if (secondOffset !== offset) result = new Date(localAsUtc - secondOffset);

  const actual = timezoneParts(result, timeZone);
  const same = ['year', 'month', 'day', 'hour', 'minute', 'second']
    .every((key) => actual[key] === desired[key]);
  return same ? result : null;
}

function normalizeDateInput(value, timezone, code, message) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date)) throw new AppError(400, code, message);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new AppError(400, code, message);
    return formatUtcMysql(value);
  }
  const text = value.trim();
  let date;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) date = new Date(text);
  else date = localDateTimeToUtc(text, timezone);
  if (!date || Number.isNaN(date.getTime())) throw new AppError(400, code, message);
  return formatUtcMysql(date);
}

function dateFromDb(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveSessionState(session, now = new Date()) {
  const programmed = Boolean(session.programar_sesion);
  const start = dateFromDb(session.fecha_inicio);
  const end = dateFromDb(session.fecha_fin);
  let window = 'open';
  if (programmed && start && now < start) window = 'before';
  if (programmed && end && now > end) window = 'after';

  const temporalOpen = window === 'open';
  const aceptarIngresos = Boolean(session.aceptar_ingresos);
  const aceptarRespuestas = Boolean(session.aceptar_respuestas);
  const puedeIngresar = temporalOpen && aceptarIngresos;
  const puedeResponder = temporalOpen && aceptarRespuestas;

  let estado;
  if (session.deleted_at || session.sesion_deleted_at) estado = 'eliminada';
  else if (window === 'before') estado = 'programada';
  else if (window === 'after') estado = 'cerrada';
  else if (aceptarRespuestas) estado = 'activa';
  else if (aceptarIngresos) estado = 'en_espera';
  else estado = 'cerrada';

  return {
    estado,
    ventana: window,
    puede_ingresar: puedeIngresar,
    puede_responder: puedeResponder,
    aceptar_ingresos: aceptarIngresos,
    aceptar_respuestas: aceptarRespuestas
  };
}

function normalizeConfig(value, base = DEFAULT_CONFIG) {
  if (value === undefined || value === null) return { ...base };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_SESSION_CONFIG', 'La configuración de sesión no es válida.');
  }
  const allowed = new Set(['permitir_regresar', 'mostrar_resultados', 'permitir_reinicio']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new AppError(400, 'INVALID_SESSION_CONFIG', 'La configuración contiene campos no permitidos.');
  }
  const result = { ...base };
  for (const key of allowed) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') {
        throw new AppError(400, 'INVALID_SESSION_CONFIG', `El campo ${key} debe ser booleano.`);
      }
      result[key] = value[key];
    }
  }
  return result;
}

function normalizePresentation(value, base = {}) {
  if (value === undefined || value === null) return { ...base };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_PRESENTATION_CONFIG', 'La configuración de presentación no es válida.');
  }
  return { ...base, ...value };
}

function joinUrl(code) {
  const base = String(process.env.FRONTEND_URL || '').trim();
  if (!base) return null;
  try {
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return new URL(`join/${code}`, normalized).toString();
  } catch {
    return null;
  }
}

function publicSessionPayload(session) {
  const state = deriveSessionState(session);
  return {
    id_sesion_evaluacion: Number(session.id_sesion_evaluacion),
    nombre: session.nombre,
    descripcion: session.descripcion || null,
    imagen_url: session.imagen_url || null,
    tipo_sesion: session.tipo_sesion,
    codigo_acceso: session.codigo_acceso,
    evaluacion: {
      id_evaluacion: Number(session.id_evaluacion),
      nombre: session.evaluacion_nombre,
      numero_version: Number(session.numero_version)
    },
    programar_sesion: Boolean(session.programar_sesion),
    fecha_inicio: utcIso(session.fecha_inicio),
    fecha_fin: utcIso(session.fecha_fin),
    timezone: session.timezone,
    estado: state.estado,
    puede_ingresar: state.puede_ingresar,
    puede_responder: state.puede_responder,
    configuracion: normalizeConfig(parseJson(session.configuracion_json, {}), DEFAULT_CONFIG),
    join_url: joinUrl(session.codigo_acceso)
  };
}

function adminSessionPayload(session) {
  const state = deriveSessionState(session);
  return {
    id_sesion_evaluacion: Number(session.id_sesion_evaluacion),
    id_evaluacion_version: Number(session.id_evaluacion_version),
    nombre: session.nombre,
    descripcion: session.descripcion || null,
    imagen_url: session.imagen_url || null,
    tipo_sesion: session.tipo_sesion,
    codigo_acceso: session.codigo_acceso,
    programar_sesion: Boolean(session.programar_sesion),
    fecha_inicio: utcIso(session.fecha_inicio),
    fecha_fin: utcIso(session.fecha_fin),
    timezone: session.timezone,
    aceptar_ingresos: Boolean(session.aceptar_ingresos),
    aceptar_respuestas: Boolean(session.aceptar_respuestas),
    id_pregunta_actual: session.id_pregunta_actual === null ? null : Number(session.id_pregunta_actual),
    configuracion: normalizeConfig(parseJson(session.configuracion_json, {}), DEFAULT_CONFIG),
    config_presentacion: parseJson(session.config_presentacion_json, {}) || {},
    estado: state.estado,
    puede_ingresar: state.puede_ingresar,
    puede_responder: state.puede_responder,
    ventana: state.ventana,
    join_url: joinUrl(session.codigo_acceso),
    evaluacion: {
      id_evaluacion: Number(session.id_evaluacion),
      nombre: session.evaluacion_nombre,
      slug: session.evaluacion_slug,
      id_evaluacion_version: Number(session.id_evaluacion_version),
      numero_version: Number(session.numero_version),
      status_version: session.version_status
    },
    creador: {
      id_usuario: Number(session.created_by),
      nombre: session.creador_nombre
    },
    created_at: utcIso(session.created_at),
    updated_at: utcIso(session.updated_at)
  };
}

function assertCreatePermission(user) {
  const caps = capabilitiesFor(user?.rol);
  if (!caps.includes('sesiones:manage:any') && !caps.includes('sesiones:manage:own')) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para administrar sesiones.');
  }
}

function assertManagePermission(user, session) {
  assertCreatePermission(user);
  const caps = capabilitiesFor(user.rol);
  if (caps.includes('sesiones:manage:any')) return;
  if (caps.includes('sesiones:manage:own') && Number(session.created_by) === Number(user.id_usuario)) return;
  throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para administrar esta sesión.');
}

function sanitizeSessionCreate(input) {
  const allowed = new Set([
    'id_evaluacion', 'id_evaluacion_version', 'nombre', 'descripcion', 'imagen_url',
    'tipo_sesion', 'programar_sesion', 'fecha_inicio', 'fecha_fin', 'timezone',
    'aceptar_ingresos', 'aceptar_respuestas', 'configuracion', 'config_presentacion'
  ]);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_SESSION_CREATE', 'Los datos de la sesión no son válidos.');
  }
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new AppError(400, 'INVALID_SESSION_CREATE', 'La sesión contiene campos no permitidos.');
  }
  const idEvaluation = parsePositiveId(
    input.id_evaluacion,
    'INVALID_EVALUATION_ID',
    'La evaluación no es válida.'
  );
  const idVersion = input.id_evaluacion_version === undefined || input.id_evaluacion_version === null
    ? null
    : parsePositiveId(input.id_evaluacion_version, 'INVALID_VERSION_ID', 'La versión no es válida.');
  const nombre = cleanString(input.nombre, {
    required: true,
    max: 200,
    code: 'INVALID_SESSION_NAME',
    message: 'El nombre de la sesión no es válido.'
  });
  const descripcion = cleanString(input.descripcion, {
    required: false,
    max: 10000,
    code: 'INVALID_SESSION_DESCRIPTION',
    message: 'La descripción de la sesión no es válida.'
  });
  const imagenUrl = cleanString(input.imagen_url, {
    required: false,
    max: 2048,
    code: 'INVALID_SESSION_IMAGE',
    message: 'La URL de imagen no es válida.'
  });
  if (!VALID_SESSION_TYPES.has(input.tipo_sesion)) {
    throw new AppError(400, 'INVALID_SESSION_TYPE', 'El tipo de sesión debe ser individual o guiada.');
  }
  const timezone = validateTimezone(input.timezone || DEFAULT_TIMEZONE);
  const programarSesion = bool(input.programar_sesion, false);
  const aceptarIngresos = bool(input.aceptar_ingresos, false);
  const aceptarRespuestas = bool(input.aceptar_respuestas, false);
  let fechaInicio = null;
  let fechaFin = null;
  if (programarSesion) {
    fechaInicio = normalizeDateInput(input.fecha_inicio, timezone, 'INVALID_START_DATE', 'La fecha de inicio no es válida.');
    fechaFin = normalizeDateInput(input.fecha_fin, timezone, 'INVALID_END_DATE', 'La fecha de fin no es válida.');
    if (!fechaInicio || !fechaFin || dateFromDb(fechaFin) <= dateFromDb(fechaInicio)) {
      throw new AppError(400, 'INVALID_SESSION_WINDOW', 'La fecha de fin debe ser posterior a la fecha de inicio.');
    }
  }
  return {
    idEvaluation,
    idVersion,
    nombre,
    descripcion,
    imagenUrl,
    tipoSesion: input.tipo_sesion,
    programarSesion,
    fechaInicio,
    fechaFin,
    timezone,
    aceptarIngresos,
    aceptarRespuestas,
    configuracion: normalizeConfig(input.configuracion),
    configPresentacionInput: input.config_presentacion
  };
}

async function uniqueCode(connection) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!await repository.codeExists(code, connection)) return code;
  }
  throw new AppError(503, 'SESSION_CODE_UNAVAILABLE', 'No fue posible generar un código de acceso único.');
}

async function ensureGuidedQuestion(connection, session, userId) {
  if (session.tipo_sesion !== 'guiada' || session.id_pregunta_actual) {
    return session.id_pregunta_actual ? Number(session.id_pregunta_actual) : null;
  }
  const first = await repository.firstQuestionId(session.id_evaluacion_version, connection);
  if (!first) throw new AppError(409, 'SESSION_HAS_NO_QUESTIONS', 'La evaluación de la sesión no contiene preguntas.');
  await repository.setCurrentQuestion(connection, session.id_sesion_evaluacion, first, userId);
  session.id_pregunta_actual = first;
  return first;
}

async function listEvaluationOptions(user) {
  assertCreatePermission(user);
  const rows = await repository.listPublishedEvaluationOptions();
  const grouped = new Map();
  for (const row of rows) {
    const id = Number(row.id_evaluacion);
    if (!grouped.has(id)) {
      grouped.set(id, {
        id_evaluacion: id,
        nombre: row.nombre,
        slug: row.slug,
        id_version_activa: row.id_version_activa === null ? null : Number(row.id_version_activa),
        versiones_publicadas: []
      });
    }
    grouped.get(id).versiones_publicadas.push({
      id_evaluacion_version: Number(row.id_evaluacion_version),
      numero_version: Number(row.numero_version),
      activa: Number(row.id_version_activa) === Number(row.id_evaluacion_version)
    });
  }
  return [...grouped.values()];
}

async function listSessions(user, search = '') {
  assertCreatePermission(user);
  const caps = capabilitiesFor(user.rol);
  const rows = await repository.listSessions({
    userId: user.id_usuario,
    all: caps.includes('sesiones:manage:any'),
    search: typeof search === 'string' ? search.trim().slice(0, 200) : ''
  });
  return rows.map((row) => ({
    ...adminSessionPayload(row),
    total_aplicaciones: Number(row.total_aplicaciones || 0),
    total_completadas: Number(row.total_completadas || 0)
  }));
}

async function getSession(idSession, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const counts = await repository.applicationCounts(idSession);
  return { sesion: adminSessionPayload(session), resumen: counts };
}

async function createSession(input, user) {
  assertCreatePermission(user);
  const clean = sanitizeSessionCreate(input);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const version = await repository.findVersionForSessionCreate(clean.idEvaluation, clean.idVersion, connection);
    if (!version) throw new AppError(404, 'EVALUATION_VERSION_NOT_FOUND', 'Evaluación o versión no encontrada.');
    if (version.evaluacion_status !== 'activa') {
      throw new AppError(409, 'EVALUATION_INACTIVE', 'La evaluación está inactiva.');
    }
    if (version.version_status !== 'published') {
      throw new AppError(409, 'VERSION_NOT_PUBLISHED', 'La sesión solo puede usar una versión publicada.');
    }

    const code = await uniqueCode(connection);
    const basePresentation = parseJson(version.config_presentacion_json, {}) || {};
    const configPresentation = normalizePresentation(clean.configPresentacionInput, basePresentation);
    let currentQuestion = null;
    if (clean.tipoSesion === 'guiada' && clean.aceptarRespuestas) {
      currentQuestion = await repository.firstQuestionId(version.id_evaluacion_version, connection);
      if (!currentQuestion) throw new AppError(409, 'SESSION_HAS_NO_QUESTIONS', 'La evaluación no contiene preguntas.');
    }

    const idSession = await repository.createSession(connection, {
      idVersion: Number(version.id_evaluacion_version),
      nombre: clean.nombre,
      descripcion: clean.descripcion,
      imagenUrl: clean.imagenUrl,
      tipoSesion: clean.tipoSesion,
      codigoAcceso: code,
      programarSesion: clean.programarSesion,
      fechaInicio: clean.fechaInicio,
      fechaFin: clean.fechaFin,
      timezone: clean.timezone,
      aceptarIngresos: clean.aceptarIngresos,
      aceptarRespuestas: clean.aceptarRespuestas,
      idPreguntaActual: currentQuestion,
      configuracion: clean.configuracion,
      configPresentacion: configPresentation,
      userId: user.id_usuario
    });
    await connection.commit();
    return getSession(idSession, user);
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'SESSION_CODE_COLLISION', 'No fue posible reservar el código de acceso. Intenta de nuevo.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

function sanitizeSessionUpdate(input, current) {
  const allowed = new Set([
    'nombre', 'descripcion', 'imagen_url', 'tipo_sesion', 'programar_sesion',
    'fecha_inicio', 'fecha_fin', 'timezone', 'configuracion', 'config_presentacion'
  ]);
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) {
    throw new AppError(400, 'INVALID_SESSION_UPDATE', 'No hay cambios válidos para aplicar.');
  }
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new AppError(400, 'INVALID_SESSION_UPDATE', 'La actualización contiene campos no permitidos.');
  }

  const changes = {};
  if (input.nombre !== undefined) changes.nombre = cleanString(input.nombre, {
    required: true,
    max: 200,
    code: 'INVALID_SESSION_NAME',
    message: 'El nombre de la sesión no es válido.'
  });
  if (input.descripcion !== undefined) changes.descripcion = cleanString(input.descripcion, {
    max: 10000,
    code: 'INVALID_SESSION_DESCRIPTION',
    message: 'La descripción de la sesión no es válida.'
  });
  if (input.imagen_url !== undefined) changes.imagen_url = cleanString(input.imagen_url, {
    max: 2048,
    code: 'INVALID_SESSION_IMAGE',
    message: 'La URL de imagen no es válida.'
  });
  if (input.tipo_sesion !== undefined) {
    if (!VALID_SESSION_TYPES.has(input.tipo_sesion)) {
      throw new AppError(400, 'INVALID_SESSION_TYPE', 'El tipo de sesión debe ser individual o guiada.');
    }
    changes.tipo_sesion = input.tipo_sesion;
  }

  const timezone = input.timezone !== undefined ? validateTimezone(input.timezone) : current.timezone;
  if (input.timezone !== undefined) changes.timezone = timezone;
  const programmed = input.programar_sesion !== undefined
    ? bool(input.programar_sesion)
    : Boolean(current.programar_sesion);
  if (input.programar_sesion !== undefined) changes.programar_sesion = programmed ? 1 : 0;

  if (programmed) {
    const startSource = input.fecha_inicio !== undefined ? input.fecha_inicio : current.fecha_inicio;
    const endSource = input.fecha_fin !== undefined ? input.fecha_fin : current.fecha_fin;
    const start = input.fecha_inicio !== undefined
      ? normalizeDateInput(startSource, timezone, 'INVALID_START_DATE', 'La fecha de inicio no es válida.')
      : current.fecha_inicio;
    const end = input.fecha_fin !== undefined
      ? normalizeDateInput(endSource, timezone, 'INVALID_END_DATE', 'La fecha de fin no es válida.')
      : current.fecha_fin;
    if (!start || !end || dateFromDb(end) <= dateFromDb(start)) {
      throw new AppError(400, 'INVALID_SESSION_WINDOW', 'La fecha de fin debe ser posterior a la fecha de inicio.');
    }
    if (input.fecha_inicio !== undefined || input.programar_sesion !== undefined) changes.fecha_inicio = start;
    if (input.fecha_fin !== undefined || input.programar_sesion !== undefined) changes.fecha_fin = end;
  } else if (input.programar_sesion !== undefined) {
    changes.fecha_inicio = null;
    changes.fecha_fin = null;
  } else if (input.fecha_inicio !== undefined || input.fecha_fin !== undefined) {
    throw new AppError(400, 'SESSION_NOT_SCHEDULED', 'Activa programar_sesion para definir fechas.');
  }

  if (input.configuracion !== undefined) {
    const existing = normalizeConfig(parseJson(current.configuracion_json, {}), DEFAULT_CONFIG);
    changes.configuracion_json = normalizeConfig(input.configuracion, existing);
  }
  if (input.config_presentacion !== undefined) {
    const existing = parseJson(current.config_presentacion_json, {}) || {};
    changes.config_presentacion_json = normalizePresentation(input.config_presentacion, existing);
  }
  return changes;
}

async function updateSession(idSession, input, user) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await repository.findSessionById(idSession, connection, true);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
    assertManagePermission(user, session);
    const changes = sanitizeSessionUpdate(input, session);

    if (changes.tipo_sesion === 'individual') changes.id_pregunta_actual = null;
    if (changes.tipo_sesion === 'guiada' && Boolean(session.aceptar_respuestas) && !session.id_pregunta_actual) {
      const first = await repository.firstQuestionId(session.id_evaluacion_version, connection);
      if (!first) throw new AppError(409, 'SESSION_HAS_NO_QUESTIONS', 'La evaluación no contiene preguntas.');
      changes.id_pregunta_actual = first;
    }

    await repository.updateSession(connection, idSession, changes, user.id_usuario);
    await connection.commit();
    return getSession(idSession, user);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteSession(idSession, user) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await repository.findSessionById(idSession, connection, true);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
    assertManagePermission(user, session);
    await repository.softDeleteSession(connection, idSession, user.id_usuario);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function assertCanEnableAfterWindow(session) {
  const state = deriveSessionState(session);
  if (state.ventana === 'after') {
    throw new AppError(409, 'SESSION_WINDOW_ENDED', 'La programación de la sesión ya terminó. Ajusta las fechas antes de reabrirla.');
  }
}

async function updateControls(idSession, input, user) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_SESSION_CONTROLS', 'Los controles no son válidos.');
  }
  const allowed = new Set(['aceptar_ingresos', 'aceptar_respuestas']);
  if (!Object.keys(input).length || Object.keys(input).some((key) => !allowed.has(key))) {
    throw new AppError(400, 'INVALID_SESSION_CONTROLS', 'Envía aceptar_ingresos y/o aceptar_respuestas.');
  }

  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await repository.findSessionById(idSession, connection, true);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
    assertManagePermission(user, session);
    const aceptarIngresos = input.aceptar_ingresos === undefined
      ? Boolean(session.aceptar_ingresos)
      : bool(input.aceptar_ingresos);
    const aceptarRespuestas = input.aceptar_respuestas === undefined
      ? Boolean(session.aceptar_respuestas)
      : bool(input.aceptar_respuestas);

    if (aceptarIngresos || aceptarRespuestas) assertCanEnableAfterWindow(session);
    if (aceptarRespuestas && session.tipo_sesion === 'guiada') {
      await ensureGuidedQuestion(connection, session, user.id_usuario);
    }
    await repository.setControls(connection, idSession, { aceptarIngresos, aceptarRespuestas }, user.id_usuario);
    await connection.commit();
    return getSession(idSession, user);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function closeSession(idSession, user) {
  return updateControls(idSession, { aceptar_ingresos: false, aceptar_respuestas: false }, user);
}

async function reopenSession(idSession, user) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await repository.findSessionById(idSession, connection, true);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
    assertManagePermission(user, session);
    const state = deriveSessionState(session);
    if (state.ventana !== 'open') {
      throw new AppError(409, 'SESSION_OUTSIDE_WINDOW', 'La sesión solo puede reabrirse dentro de su ventana programada.');
    }
    if (session.tipo_sesion === 'guiada') await ensureGuidedQuestion(connection, session, user.id_usuario);
    await repository.setControls(connection, idSession, { aceptarIngresos: true, aceptarRespuestas: true }, user.id_usuario);
    await connection.commit();
    return getSession(idSession, user);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getLiveSession(idSession, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const current = session.id_pregunta_actual ? Number(session.id_pregunta_actual) : null;
  const [counts, applications, currentQuestion, currentOptions] = await Promise.all([
    repository.applicationCounts(idSession),
    repository.listLiveApplications(idSession, current),
    current ? repository.findQuestionById(session.id_evaluacion_version, current) : Promise.resolve(null),
    current ? repository.getQuestionOptions(current) : Promise.resolve([])
  ]);
  const respondedCurrent = current
    ? applications.filter((a) => Boolean(a.respondio_actual)).length
    : null;
  return {
    sesion: adminSessionPayload(session),
    resumen: {
      ...counts,
      respondieron_actual: respondedCurrent,
      sin_responder_actual: current === null ? null : applications.length - respondedCurrent
    },
    pregunta_actual: currentQuestion ? {
      id_pregunta: Number(currentQuestion.id_pregunta),
      texto: currentQuestion.texto,
      tipo: currentQuestion.tipo,
      orden: Number(currentQuestion.orden),
      requerida: Boolean(currentQuestion.requerida),
      configuracion: parseJson(currentQuestion.configuracion_json, {}) || {},
      opciones: currentOptions.map((o) => ({
        id_opcion: Number(o.id_opcion),
        texto: o.texto,
        orden: Number(o.orden)
      }))
    } : null,
    aplicaciones: applications.map((row) => ({
      id_aplicacion: Number(row.id_aplicacion),
      nombre: row.nombre,
      status: row.status,
      respondio_actual: row.respondio_actual === null ? null : Boolean(row.respondio_actual),
      started_at: utcIso(row.started_at),
      completed_at: utcIso(row.completed_at),
      created_at: utcIso(row.created_at),
      updated_at: utcIso(row.updated_at)
    }))
  };
}

async function navigateGuided(idSession, input, user) {
  const action = input?.accion;
  const force = input?.forzar === undefined ? false : bool(input.forzar);
  if (!['siguiente', 'anterior'].includes(action)) {
    throw new AppError(400, 'INVALID_NAVIGATION_ACTION', 'La acción debe ser siguiente o anterior.');
  }
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await repository.findSessionById(idSession, connection, true);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
    assertManagePermission(user, session);
    if (session.tipo_sesion !== 'guiada') {
      throw new AppError(409, 'SESSION_NOT_GUIDED', 'Esta operación solo aplica a sesiones guiadas.');
    }
    await ensureGuidedQuestion(connection, session, user.id_usuario);
    const questions = await repository.listQuestionMeta(session.id_evaluacion_version, connection);
    const currentIndex = questions.findIndex((q) => Number(q.id_pregunta) === Number(session.id_pregunta_actual));
    if (currentIndex < 0) throw new AppError(409, 'CURRENT_QUESTION_INVALID', 'La pregunta actual no pertenece a la versión de la sesión.');

    if (action === 'siguiente' && !force) {
      const pending = await repository.countUnansweredForQuestion(idSession, session.id_pregunta_actual, connection);
      if (pending > 0) {
        const error = new AppError(409, 'PARTICIPANTS_PENDING', `Aún hay ${pending} participante(s) sin contestar.`);
        error.details = [{ sin_responder: pending }];
        throw error;
      }
    }

    const nextIndex = action === 'siguiente' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0) throw new AppError(409, 'NO_PREVIOUS_QUESTION', 'Ya estás en la primera pregunta.');
    if (nextIndex >= questions.length) throw new AppError(409, 'NO_NEXT_QUESTION', 'Ya estás en la última pregunta.');

    const target = Number(questions[nextIndex].id_pregunta);
    await repository.setCurrentQuestion(connection, idSession, target, user.id_usuario);
    await connection.commit();
    return getLiveSession(idSession, user);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function normalizeCode(code) {
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) throw new AppError(400, 'INVALID_SESSION_CODE', 'El código debe contener 6 dígitos.');
  return value;
}

async function getJoinInfo(code) {
  const session = await repository.findSessionByCode(normalizeCode(code));
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'No encontramos una sesión con ese código.');
  return { sesion: publicSessionPayload(session) };
}

function newApplicationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function applicationPayload(application) {
  return {
    id_aplicacion: Number(application.id_aplicacion),
    nombre: application.nombre,
    status: application.status,
    started_at: utcIso(application.started_at),
    completed_at: utcIso(application.completed_at),
    created_at: utcIso(application.created_at),
    updated_at: utcIso(application.updated_at)
  };
}

async function joinSession(code, input, existingToken = null) {
  const normalizedCode = normalizeCode(code);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await repository.findSessionByCode(normalizedCode, connection, true);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'No encontramos una sesión con ese código.');

    if (existingToken) {
      const existing = await repository.findApplicationForSessionToken(
        session.id_sesion_evaluacion,
        existingToken,
        connection,
        true
      );
      if (!existing) throw new AppError(401, 'INVALID_APPLICATION_TOKEN', 'La participación guardada ya no es válida.');
      await connection.commit();
      return {
        sesion: publicSessionPayload(session),
        aplicacion: applicationPayload(existing),
        access_token: existing.access_token,
        reanudada: true
      };
    }

    const state = deriveSessionState(session);
    if (!state.puede_ingresar) {
      const codeError = state.ventana === 'before' ? 'SESSION_NOT_STARTED' : state.ventana === 'after' ? 'SESSION_ENDED' : 'SESSION_NOT_ACCEPTING_ENTRIES';
      throw new AppError(409, codeError, state.ventana === 'before'
        ? 'La sesión todavía no inicia.'
        : state.ventana === 'after'
          ? 'La sesión ya terminó.'
          : 'La sesión no está aceptando nuevos ingresos.');
    }

    const nombre = cleanString(input?.nombre, {
      required: true,
      max: 150,
      code: 'INVALID_PARTICIPANT_NAME',
      message: 'Escribe un nombre válido.'
    });
    const token = newApplicationToken();
    const idApplication = await repository.createApplication(connection, session.id_sesion_evaluacion, nombre, token);
    if (state.puede_responder) await repository.markApplicationStarted(connection, idApplication);
    const application = await repository.findApplicationForSessionToken(session.id_sesion_evaluacion, token, connection, false);
    await connection.commit();
    return {
      sesion: publicSessionPayload(session),
      aplicacion: applicationPayload(application),
      access_token: token,
      reanudada: false
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function requireToken(token) {
  const value = typeof token === 'string' ? token.trim() : '';
  if (!value || value.length < 20 || value.length > 255) {
    throw new AppError(401, 'APPLICATION_TOKEN_REQUIRED', 'La participación no es válida.');
  }
  return value;
}

async function loadApplication(token, connection = repository.pool, lock = false) {
  const application = await repository.findApplicationByToken(requireToken(token), connection, lock);
  if (!application) throw new AppError(401, 'INVALID_APPLICATION_TOKEN', 'La participación no es válida o ya no existe.');
  return application;
}

function sessionViewFromApplication(application) {
  return {
    id_sesion_evaluacion: application.id_sesion_evaluacion,
    nombre: application.sesion_nombre,
    descripcion: application.sesion_descripcion,
    imagen_url: application.imagen_url,
    tipo_sesion: application.tipo_sesion,
    codigo_acceso: application.codigo_acceso,
    programar_sesion: application.programar_sesion,
    fecha_inicio: application.fecha_inicio,
    fecha_fin: application.fecha_fin,
    timezone: application.timezone,
    aceptar_ingresos: application.aceptar_ingresos,
    aceptar_respuestas: application.aceptar_respuestas,
    id_pregunta_actual: application.id_pregunta_actual,
    id_evaluacion: application.id_evaluacion,
    numero_version: application.numero_version,
    evaluacion_nombre: application.evaluacion_nombre,
    deleted_at: application.sesion_deleted_at
  };
}

async function participantState(token) {
  const application = await loadApplication(token);
  const sessionState = deriveSessionState(application);
  const progress = await repository.participantProgress(
    application.id_aplicacion,
    application.id_evaluacion_version,
    application.tipo_sesion === 'guiada' ? application.id_pregunta_actual : null
  );
  return {
    sesion: publicSessionPayload(sessionViewFromApplication(application)),
    aplicacion: applicationPayload(application),
    estado_operativo: {
      puede_responder: sessionState.puede_responder,
      pausada: sessionState.estado === 'en_espera',
      antes_de_inicio: sessionState.ventana === 'before',
      finalizada_por_horario: sessionState.ventana === 'after'
    },
    progreso: progress,
    id_pregunta_actual: application.tipo_sesion === 'guiada' && application.id_pregunta_actual
      ? Number(application.id_pregunta_actual)
      : null
  };
}

async function startParticipation(token) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const application = await loadApplication(token, connection, true);
    if (application.status === 'completada') {
      await connection.commit();
      return participantState(token);
    }
    const state = deriveSessionState(application);
    if (!state.puede_responder) throw new AppError(409, 'RESPONSES_NOT_AVAILABLE', 'La sesión no está aceptando respuestas en este momento.');
    await repository.markApplicationStarted(connection, application.id_aplicacion);
    await connection.commit();
    return participantState(token);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function publicQuestionPayload(data, existingResponse = null) {
  const q = data.question;
  return {
    id_pregunta: Number(q.id_pregunta),
    texto: q.texto,
    tipo: q.tipo,
    orden: Number(q.orden),
    requerida: Boolean(q.requerida),
    configuracion: parseJson(q.configuracion_json, {}) || {},
    opciones: data.options.map((o) => ({
      id_opcion: Number(o.id_opcion),
      texto: o.texto,
      orden: Number(o.orden)
    })),
    respuesta_actual: existingResponse ? parseJson(existingResponse.valor_json, null) : null
  };
}

async function getParticipantQuestion(token, order = null) {
  const application = await loadApplication(token);
  if (application.status === 'completada') throw new AppError(409, 'APPLICATION_COMPLETED', 'La evaluación ya fue completada.');
  const state = deriveSessionState(application);
  if (!state.puede_responder) throw new AppError(409, 'RESPONSES_NOT_AVAILABLE', 'La sesión no está aceptando respuestas en este momento.');

  let question;
  if (application.tipo_sesion === 'guiada') {
    if (!application.id_pregunta_actual) throw new AppError(409, 'CURRENT_QUESTION_NOT_SET', 'El anfitrión todavía no ha seleccionado una pregunta.');
    question = await repository.getQuestionPublic(application.id_evaluacion_version, application.id_pregunta_actual);
  } else {
    const requestedOrder = order === null || order === undefined || order === ''
      ? null
      : Number(order);
    if (requestedOrder !== null && (!Number.isInteger(requestedOrder) || requestedOrder <= 0)) {
      throw new AppError(400, 'INVALID_QUESTION_ORDER', 'El número de pregunta no es válido.');
    }
    const progress = await repository.participantProgress(application.id_aplicacion, application.id_evaluacion_version);
    let targetOrder = requestedOrder;
    if (targetOrder === null) {
      targetOrder = progress.max_orden_respondida === null ? 1 : progress.max_orden_respondida + 1;
      if (targetOrder > progress.total_preguntas) targetOrder = progress.total_preguntas;
    }
    const config = normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG);
    if (!config.permitir_regresar && progress.max_orden_respondida !== null && targetOrder < progress.max_orden_respondida) {
      throw new AppError(409, 'BACK_NAVIGATION_NOT_ALLOWED', 'Esta sesión no permite regresar a preguntas anteriores.');
    }
    const q = await repository.findQuestionByOrder(application.id_evaluacion_version, targetOrder);
    question = q ? { question: q, options: await repository.getQuestionOptions(q.id_pregunta) } : null;
  }
  if (!question) throw new AppError(404, 'QUESTION_NOT_FOUND', 'Pregunta no encontrada.');
  const response = await repository.findResponse(application.id_aplicacion, question.question.id_pregunta);
  return {
    pregunta: publicQuestionPayload(question, response),
    total_preguntas: await repository.countQuestions(application.id_evaluacion_version),
    tipo_sesion: application.tipo_sesion
  };
}

function uniqueIntegerArray(value, code, message) {
  if (!Array.isArray(value)) throw new AppError(400, code, message);
  const ids = value.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new AppError(400, code, message);
  }
  return ids;
}

function normalizeAnswer(question, options, value) {
  const optionIds = new Set(options.map((o) => Number(o.id_opcion)));
  const config = parseJson(question.configuracion_json, {}) || {};

  if (question.tipo === 'single_choice') {
    const id = Number(value);
    if (!Number.isInteger(id) || !optionIds.has(id)) {
      throw new AppError(400, 'INVALID_SINGLE_ANSWER', 'Selecciona una opción válida.');
    }
    return id;
  }
  if (question.tipo === 'multiple_choice') {
    const ids = uniqueIntegerArray(value, 'INVALID_MULTIPLE_ANSWER', 'La selección múltiple no es válida.');
    if (ids.some((id) => !optionIds.has(id))) throw new AppError(400, 'INVALID_MULTIPLE_ANSWER', 'Una opción seleccionada no pertenece a la pregunta.');
    const min = Number(config.min_selecciones ?? 1);
    const max = config.max_selecciones === null || config.max_selecciones === undefined
      ? null
      : Number(config.max_selecciones);
    if (ids.length < min || (max !== null && ids.length > max)) {
      throw new AppError(400, 'INVALID_SELECTION_COUNT', 'La cantidad de opciones seleccionadas no cumple las reglas de la pregunta.');
    }
    return ids;
  }
  if (question.tipo === 'ranking') {
    const ids = uniqueIntegerArray(value, 'INVALID_RANKING_ANSWER', 'El ranking no es válido.');
    if (ids.length !== options.length || ids.some((id) => !optionIds.has(id))) {
      throw new AppError(400, 'INVALID_RANKING_ANSWER', 'El ranking debe contener todas las opciones exactamente una vez.');
    }
    return ids;
  }
  throw new AppError(400, 'INVALID_QUESTION_TYPE', 'El tipo de pregunta no es compatible.');
}

async function saveAnswer(token, idQuestion, value) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const application = await loadApplication(token, connection, true);
    if (application.status === 'completada') throw new AppError(409, 'APPLICATION_COMPLETED', 'La evaluación ya fue completada.');
    const state = deriveSessionState(application);
    if (!state.puede_responder) throw new AppError(409, 'RESPONSES_NOT_AVAILABLE', 'La sesión no está aceptando respuestas en este momento.');
    const question = await repository.findQuestionById(application.id_evaluacion_version, idQuestion, connection);
    if (!question) throw new AppError(404, 'QUESTION_NOT_FOUND', 'La pregunta no pertenece a esta evaluación.');
    if (application.tipo_sesion === 'guiada' && Number(application.id_pregunta_actual) !== Number(idQuestion)) {
      throw new AppError(409, 'QUESTION_NOT_ACTIVE', 'Solo puedes responder la pregunta activa.');
    }
    if (application.tipo_sesion === 'individual') {
      const config = normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG);
      if (!config.permitir_regresar) {
        const progress = await repository.participantProgress(application.id_aplicacion, application.id_evaluacion_version, null, connection);
        if (progress.max_orden_respondida !== null && Number(question.orden) < progress.max_orden_respondida) {
          throw new AppError(409, 'BACK_NAVIGATION_NOT_ALLOWED', 'Esta sesión no permite modificar preguntas anteriores.');
        }
      }
    }
    const options = await repository.getQuestionOptions(idQuestion, connection);
    const normalized = normalizeAnswer(question, options, value);
    if (application.status === 'por_aplicar') await repository.markApplicationStarted(connection, application.id_aplicacion);
    await repository.upsertResponse(connection, application.id_aplicacion, idQuestion, normalized);
    await connection.commit();
    const progress = await repository.participantProgress(
      application.id_aplicacion,
      application.id_evaluacion_version,
      application.tipo_sesion === 'guiada' ? application.id_pregunta_actual : null
    );
    return { id_pregunta: Number(idQuestion), valor: normalized, progreso: progress };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function buildScoring(scoringData, responseRows) {
  const responses = new Map(responseRows.map((r) => [Number(r.id_pregunta), parseJson(r.valor_json, null)]));
  const optionsByQuestion = new Map();
  const optionById = new Map();
  for (const option of scoringData.options) {
    const qid = Number(option.id_pregunta);
    const normalized = { ...option, id_opcion: Number(option.id_opcion), id_pregunta: qid };
    if (!optionsByQuestion.has(qid)) optionsByQuestion.set(qid, []);
    optionsByQuestion.get(qid).push(normalized);
    optionById.set(normalized.id_opcion, normalized);
  }
  const mappingsByOption = new Map();
  for (const mapping of scoringData.mappings) {
    const oid = Number(mapping.id_opcion);
    if (!mappingsByOption.has(oid)) mappingsByOption.set(oid, []);
    mappingsByOption.get(oid).push({
      id_dimension: Number(mapping.id_dimension),
      valor: Number(mapping.valor)
    });
  }
  const dimensionValues = new Map(scoringData.dimensions.map((d) => [Number(d.id_dimension), 0]));
  let score = 0;
  let maxScore = 0;
  const missingRequired = [];

  for (const question of scoringData.questions) {
    const qid = Number(question.id_pregunta);
    const value = responses.get(qid);
    const options = optionsByQuestion.get(qid) || [];
    const questionValue = Number(question.valor || 0);
    if ((question.tipo === 'single_choice' || question.tipo === 'multiple_choice') && questionValue > 0) {
      maxScore += questionValue;
    }
    if ((value === undefined || value === null) && Boolean(question.requerida)) {
      missingRequired.push({ id_pregunta: qid, orden: Number(question.orden), texto: question.texto });
      continue;
    }
    if (value === undefined || value === null) continue;

    if (question.tipo === 'single_choice' || question.tipo === 'multiple_choice') {
      const selected = question.tipo === 'single_choice' ? [Number(value)] : (Array.isArray(value) ? value.map(Number) : []);
      const correct = options.filter((o) => Boolean(o.es_correcta)).map((o) => o.id_opcion).sort((a, b) => a - b);
      const selectedSorted = [...selected].sort((a, b) => a - b);
      if (questionValue > 0 && correct.length === selectedSorted.length && correct.every((id, i) => id === selectedSorted[i])) {
        score += questionValue;
      }
      for (const oid of selected) {
        for (const rel of mappingsByOption.get(oid) || []) {
          dimensionValues.set(rel.id_dimension, (dimensionValues.get(rel.id_dimension) || 0) + rel.valor);
        }
      }
    } else if (question.tipo === 'ranking') {
      const config = parseJson(question.configuracion_json, {}) || {};
      const positionValues = Array.isArray(config.valores_posicion) ? config.valores_posicion.map(Number) : [];
      const rankingValue = Array.isArray(value) ? value : [];
      for (let index = 0; index < rankingValue.length; index += 1) {
        const oid = Number(rankingValue[index]);
        const multiplier = Number(positionValues[index] ?? 0);
        for (const rel of mappingsByOption.get(oid) || []) {
          dimensionValues.set(rel.id_dimension, (dimensionValues.get(rel.id_dimension) || 0) + rel.valor * multiplier);
        }
      }
    }
  }

  const dimensions = scoringData.dimensions.map((d) => ({
    id_dimension: Number(d.id_dimension),
    codigo: d.codigo,
    nombre: d.nombre,
    descripcion: d.descripcion || null,
    color: d.color || null,
    icono: d.icono || null,
    orden: Number(d.orden || 0),
    valor: Number((dimensionValues.get(Number(d.id_dimension)) || 0).toFixed(2))
  }));
  const totalDimensions = dimensions.reduce((sum, d) => sum + d.valor, 0);
  for (const item of dimensions) {
    item.porcentaje = totalDimensions > 0 ? Number(((item.valor / totalDimensions) * 100).toFixed(2)) : 0;
  }

  return {
    score: Number(score.toFixed(2)),
    maxScore: Number(maxScore.toFixed(2)),
    scorePercentage: maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(2)) : null,
    dimensions,
    missingRequired,
    responses
  };
}

async function finishParticipation(token) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const application = await loadApplication(token, connection, true);
    if (application.status === 'completada') {
      const existing = await repository.getResultForApplication(application.id_aplicacion, connection);
      await connection.commit();
      return {
        completada: true,
        mostrar_resultados: normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG).mostrar_resultados,
        resultado: existing ? normalizeStoredResult(existing) : null
      };
    }
    const state = deriveSessionState(application);
    if (!state.puede_responder) throw new AppError(409, 'RESPONSES_NOT_AVAILABLE', 'La sesión no está aceptando respuestas en este momento.');
    const [scoringData, responses] = await Promise.all([
      repository.getScoringData(application.id_evaluacion_version, connection),
      repository.listResponses(application.id_aplicacion, connection)
    ]);
    const scoring = buildScoring(scoringData, responses);
    if (scoring.missingRequired.length) {
      const error = new AppError(422, 'REQUIRED_ANSWERS_MISSING', 'Faltan preguntas requeridas por responder.');
      error.details = scoring.missingRequired;
      throw error;
    }
    const resultJson = {
      puntaje_correctas: scoring.score,
      puntaje_maximo: scoring.maxScore,
      porcentaje_correctas: scoring.scorePercentage,
      dimensiones: scoring.dimensions,
      calculado_at: new Date().toISOString()
    };
    const presentation = parseJson(application.config_presentacion_json, {}) || {};
    const idResult = await repository.upsertResult(
      connection,
      application.id_aplicacion,
      scoring.score,
      scoring.maxScore,
      resultJson,
      presentation
    );
    await repository.replaceResultDimensions(connection, idResult, scoring.dimensions);
    await repository.completeApplication(connection, application.id_aplicacion);
    await connection.commit();
    const config = normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG);
    return {
      completada: true,
      mostrar_resultados: config.mostrar_resultados,
      resultado: config.mostrar_resultados ? resultJson : null
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function normalizeStoredResult(data) {
  if (!data) return null;
  const base = parseJson(data.result.resultado_json, {}) || {};
  const baseDimensions = new Map((Array.isArray(base.dimensiones) ? base.dimensiones : []).map((d) => [Number(d.id_dimension), d]));
  return {
    ...base,
    id_resultado: Number(data.result.id_resultado),
    puntaje_correctas: data.result.puntaje_correctas === null ? null : Number(data.result.puntaje_correctas),
    puntaje_maximo: data.result.puntaje_maximo === null ? null : Number(data.result.puntaje_maximo),
    presentacion: parseJson(data.result.presentacion_snapshot_json, {}) || {},
    dimensiones: data.dimensions.map((d) => ({
      id_dimension: Number(d.id_dimension),
      codigo: d.codigo,
      nombre: d.nombre,
      descripcion: d.descripcion || null,
      color: d.color || null,
      icono: d.icono || null,
      orden: Number(d.orden || 0),
      valor: Number(d.valor),
      porcentaje: Number(baseDimensions.get(Number(d.id_dimension))?.porcentaje || 0)
    })),
    created_at: utcIso(data.result.created_at),
    updated_at: utcIso(data.result.updated_at)
  };
}

function readableResponses(scoringData, responseRows) {
  const options = new Map(scoringData.options.map((o) => [Number(o.id_opcion), {
    id_opcion: Number(o.id_opcion),
    texto: o.texto,
    orden: Number(o.orden)
  }]));
  const questions = new Map(scoringData.questions.map((q) => [Number(q.id_pregunta), q]));
  return responseRows.map((r) => {
    const q = questions.get(Number(r.id_pregunta)) || r;
    const raw = parseJson(r.valor_json, null);
    let seleccion = [];
    if (q.tipo === 'single_choice') {
      const item = options.get(Number(raw));
      if (item) seleccion = [item];
    } else if (Array.isArray(raw)) {
      seleccion = raw.map((id, index) => {
        const item = options.get(Number(id));
        return item ? { ...item, posicion: q.tipo === 'ranking' ? index + 1 : undefined } : null;
      }).filter(Boolean);
    }
    return {
      id_pregunta: Number(r.id_pregunta),
      orden: Number(q.orden || r.orden || 0),
      texto: q.texto || r.texto,
      tipo: q.tipo || r.tipo,
      valor: raw,
      seleccion
    };
  });
}

async function participantResult(token) {
  const application = await loadApplication(token);
  if (application.status !== 'completada') throw new AppError(409, 'APPLICATION_NOT_COMPLETED', 'La evaluación todavía no ha finalizado.');
  const config = normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG);
  if (!config.mostrar_resultados) {
    return { mostrar_resultados: false, resultado: null };
  }
  const [result, responses, scoringData] = await Promise.all([
    repository.getResultForApplication(application.id_aplicacion),
    repository.listResponses(application.id_aplicacion),
    repository.getScoringData(application.id_evaluacion_version)
  ]);
  if (!result) throw new AppError(404, 'RESULT_NOT_FOUND', 'No se encontró el resultado de la evaluación.');
  return {
    mostrar_resultados: true,
    resultado: normalizeStoredResult(result),
    respuestas: readableResponses(scoringData, responses)
  };
}

async function restartParticipation(token) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const application = await loadApplication(token, connection, true);
    const config = normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG);
    if (!config.permitir_reinicio) throw new AppError(403, 'RESTART_NOT_ALLOWED', 'Esta sesión no permite reiniciar la evaluación.');
    const state = deriveSessionState(application);
    if (!state.puede_responder) throw new AppError(409, 'RESPONSES_NOT_AVAILABLE', 'La sesión no está aceptando respuestas en este momento.');
    await repository.restartApplication(connection, application.id_aplicacion);
    await connection.commit();
    return participantState(token);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function adminApplicationResult(idSession, idApplication, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const application = await repository.findApplicationForAdmin(idSession, idApplication);
  if (!application) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Participación no encontrada.');
  const [result, responses, scoringData] = await Promise.all([
    repository.getResultForApplication(idApplication),
    repository.listResponses(idApplication),
    repository.getScoringData(session.id_evaluacion_version)
  ]);
  return {
    aplicacion: applicationPayload(application),
    resultado: result ? normalizeStoredResult(result) : null,
    respuestas: readableResponses(scoringData, responses)
  };
}

async function adminResults(idSession, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const data = await repository.aggregateResults(idSession);
  const totalDimensional = data.dimensions.reduce((sum, d) => sum + Number(d.valor || 0), 0);
  return {
    sesion: adminSessionPayload(session),
    resumen: data.counts,
    dimensiones: data.dimensions.map((d) => {
      const value = Number(d.valor || 0);
      return {
        id_dimension: Number(d.id_dimension),
        codigo: d.codigo,
        nombre: d.nombre,
        descripcion: d.descripcion || null,
        color: d.color || null,
        icono: d.icono || null,
        orden: Number(d.orden || 0),
        valor: value,
        porcentaje: totalDimensional > 0 ? Number(((value / totalDimensional) * 100).toFixed(2)) : 0
      };
    }),
    aplicaciones: data.applications.map((a) => ({
      id_aplicacion: Number(a.id_aplicacion),
      nombre: a.nombre,
      status: a.status,
      started_at: utcIso(a.started_at),
      completed_at: utcIso(a.completed_at),
      resultado: a.id_resultado ? {
        id_resultado: Number(a.id_resultado),
        puntaje_correctas: a.puntaje_correctas === null ? null : Number(a.puntaje_correctas),
        puntaje_maximo: a.puntaje_maximo === null ? null : Number(a.puntaje_maximo),
        resultado: parseJson(a.resultado_json, {}) || {},
        presentacion: parseJson(a.presentacion_snapshot_json, {}) || {}
      } : null
    }))
  };
}

function validateEmail(email) {
  const value = cleanString(email, {
    required: true,
    max: 254,
    code: 'INVALID_EMAIL',
    message: 'El correo no es válido.'
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AppError(400, 'INVALID_EMAIL', 'El correo no es válido.');
  return value.toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function mailer() {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  if (required.some((key) => !process.env[key])) {
    throw new AppError(500, 'MAILER_NOT_CONFIGURED', 'El servicio de correo no está configurado.');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function emailContent({ name, sessionName, evaluationName, snapshot }) {
  const score = snapshot.puntaje_maximo > 0
    ? `${snapshot.puntaje_correctas} / ${snapshot.puntaje_maximo}`
    : null;
  const dimensions = Array.isArray(snapshot.dimensiones) ? snapshot.dimensiones : [];
  const dimensionText = dimensions.length
    ? `\n\nResultados por dimensión:\n${dimensions.map((d) => `- ${d.nombre}: ${d.valor}${d.porcentaje !== undefined ? ` (${d.porcentaje}%)` : ''}`).join('\n')}`
    : '';
  const dimensionHtml = dimensions.length
    ? `<h3>Resultados por dimensión</h3><ul>${dimensions.map((d) => `<li><strong>${escapeHtml(d.nombre)}</strong>: ${escapeHtml(d.valor)}${d.porcentaje !== undefined ? ` (${escapeHtml(d.porcentaje)}%)` : ''}</li>`).join('')}</ul>`
    : '';
  return {
    subject: `Resultados de ${evaluationName} · Genius Quiz`,
    text: `Hola ${name}.\n\nEstos son tus resultados de ${evaluationName}${sessionName ? ` (${sessionName})` : ''}.${score ? `\n\nPuntaje: ${score}` : ''}${dimensionText}\n\nGenius Quiz`,
    html: `<p>Hola ${escapeHtml(name)}.</p><p>Estos son tus resultados de <strong>${escapeHtml(evaluationName)}</strong>${sessionName ? ` (${escapeHtml(sessionName)})` : ''}.</p>${score ? `<p><strong>Puntaje:</strong> ${escapeHtml(score)}</p>` : ''}${dimensionHtml}<p>Genius Quiz</p>`
  };
}

async function sendStoredEmail({ idSend, email, name, sessionName, evaluationName, snapshot }) {
  await repository.markEmailSending(repository.pool, idSend);
  try {
    const content = emailContent({ name, sessionName, evaluationName, snapshot });
    const info = await mailer().sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html
    });
    await repository.markEmailSuccess(repository.pool, idSend, info?.messageId || null);
    return { id_envio: idSend, status: 'exito', email };
  } catch (error) {
    await repository.markEmailError(repository.pool, idSend, error.message || 'Error al enviar correo.');
    throw new AppError(502, 'EMAIL_SEND_FAILED', 'No fue posible enviar el correo de resultados.');
  }
}

async function createAndSendEmail({ application, email }) {
  const result = await repository.getResultForApplication(application.id_aplicacion);
  if (!result) throw new AppError(404, 'RESULT_NOT_FOUND', 'No se encontró el resultado de la evaluación.');
  const normalized = normalizeStoredResult(result);
  const snapshot = {
    puntaje_correctas: normalized.puntaje_correctas,
    puntaje_maximo: normalized.puntaje_maximo,
    porcentaje_correctas: normalized.porcentaje_correctas ?? null,
    dimensiones: normalized.dimensiones
  };
  const connection = await repository.pool.getConnection();
  let idSend;
  try {
    await connection.beginTransaction();
    idSend = await repository.createEmailSend(connection, application.id_aplicacion, email, snapshot);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return sendStoredEmail({
    idSend,
    email,
    name: application.nombre,
    sessionName: application.sesion_nombre,
    evaluationName: application.evaluacion_nombre,
    snapshot
  });
}

async function participantSendEmail(token, emailInput) {
  const application = await loadApplication(token);
  if (application.status !== 'completada') throw new AppError(409, 'APPLICATION_NOT_COMPLETED', 'La evaluación todavía no ha finalizado.');
  const config = normalizeConfig(parseJson(application.configuracion_json, {}), DEFAULT_CONFIG);
  if (!config.mostrar_resultados) throw new AppError(403, 'RESULTS_HIDDEN', 'Los resultados de esta sesión no están visibles para participantes.');
  return createAndSendEmail({ application, email: validateEmail(emailInput) });
}

async function adminSendEmail(idSession, idApplication, emailInput, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const applicationBase = await repository.findApplicationForAdmin(idSession, idApplication);
  if (!applicationBase) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Participación no encontrada.');
  if (applicationBase.status !== 'completada') throw new AppError(409, 'APPLICATION_NOT_COMPLETED', 'La evaluación todavía no ha finalizado.');
  const application = {
    ...applicationBase,
    sesion_nombre: session.nombre,
    evaluacion_nombre: session.evaluacion_nombre
  };
  return createAndSendEmail({ application, email: validateEmail(emailInput) });
}

async function listEmailSends(idSession, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const rows = await repository.listEmailSends(idSession);
  return rows.map((r) => ({
    id_envio: Number(r.id_envio),
    id_aplicacion: Number(r.id_aplicacion),
    aplicacion_nombre: r.aplicacion_nombre,
    email: r.email,
    status: r.status,
    attempt_count: Number(r.attempt_count || 0),
    last_attempt_at: utcIso(r.last_attempt_at),
    sent_at: utcIso(r.sent_at),
    provider_message_id: r.provider_message_id || null,
    error_message: r.error_message || null,
    created_at: utcIso(r.created_at),
    updated_at: utcIso(r.updated_at)
  }));
}

async function retryEmail(idSession, idSend, user) {
  const session = await repository.findSessionById(idSession);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada.');
  assertManagePermission(user, session);
  const send = await repository.findEmailSend(idSession, idSend);
  if (!send) throw new AppError(404, 'EMAIL_SEND_NOT_FOUND', 'Envío no encontrado.');
  if (send.status !== 'error') throw new AppError(409, 'EMAIL_RETRY_NOT_ALLOWED', 'Solo los envíos con error pueden reintentarse.');
  const snapshot = parseJson(send.resultado_snapshot_json, {}) || {};
  return sendStoredEmail({
    idSend: Number(send.id_envio),
    email: send.email,
    name: send.aplicacion_nombre,
    sessionName: session.nombre,
    evaluationName: session.evaluacion_nombre,
    snapshot
  });
}

module.exports = {
  listEvaluationOptions,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  updateControls,
  closeSession,
  reopenSession,
  getLiveSession,
  navigateGuided,
  getJoinInfo,
  joinSession,
  participantState,
  startParticipation,
  getParticipantQuestion,
  saveAnswer,
  finishParticipation,
  participantResult,
  restartParticipation,
  adminApplicationResult,
  adminResults,
  participantSendEmail,
  adminSendEmail,
  listEmailSends,
  retryEmail
};
