const service = require('./trash.service');
const { AppError } = require('../../utils/app-error');

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'INVALID_ID', 'El identificador no es válido.');
  return id;
}

async function list(req, res, next) {
  try {
    res.json({ ok: true, data: await service.list(req.user) });
  } catch (error) { next(error); }
}

async function restoreEvaluation(req, res, next) {
  try {
    await service.restoreEvaluation(parseId(req.params.id), req.user);
    res.json({ ok: true, data: { restored: true } });
  } catch (error) { next(error); }
}

async function restoreVersion(req, res, next) {
  try {
    await service.restoreVersion(parseId(req.params.id), req.user);
    res.json({ ok: true, data: { restored: true } });
  } catch (error) { next(error); }
}

async function restoreSession(req, res, next) {
  try {
    await service.restoreSession(parseId(req.params.id), req.user);
    res.json({ ok: true, data: { restored: true } });
  } catch (error) { next(error); }
}

async function purgeEvaluation(req, res, next) {
  try {
    await service.purgeEvaluation(parseId(req.params.id), req.body?.confirmacion, req.user);
    res.status(204).send();
  } catch (error) { next(error); }
}

async function purgeVersion(req, res, next) {
  try {
    await service.purgeVersion(parseId(req.params.id), req.body?.confirmacion, req.user);
    res.status(204).send();
  } catch (error) { next(error); }
}

async function purgeSession(req, res, next) {
  try {
    await service.purgeSession(parseId(req.params.id), req.user);
    res.status(204).send();
  } catch (error) { next(error); }
}

module.exports = {
  list,
  restoreEvaluation,
  restoreVersion,
  restoreSession,
  purgeEvaluation,
  purgeVersion,
  purgeSession
};
