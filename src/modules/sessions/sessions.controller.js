const service = require('./sessions.service');
const { AppError } = require('../../utils/app-error');

function parseId(value, code = 'INVALID_ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, code, 'El identificador no es válido.');
  return id;
}

function applicationToken(req) {
  const header = req.header('X-Application-Token');
  if (header) return header;
  const authorization = req.header('Authorization') || '';
  const [scheme, token] = authorization.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

async function evaluationOptions(req, res, next) {
  try {
    res.json({ ok: true, data: { evaluaciones: await service.listEvaluationOptions(req.user) } });
  } catch (error) { next(error); }
}

async function list(req, res, next) {
  try {
    res.json({ ok: true, data: { sesiones: await service.listSessions(req.user, req.query.search || '') } });
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getSession(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user) });
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try {
    res.status(201).json({ ok: true, data: await service.createSession(req.body || {}, req.user) });
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    res.json({ ok: true, data: await service.updateSession(parseId(req.params.id, 'INVALID_SESSION_ID'), req.body || {}, req.user) });
  } catch (error) { next(error); }
}

async function remove(req, res, next) {
  try {
    await service.deleteSession(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user);
    res.status(204).send();
  } catch (error) { next(error); }
}

async function controls(req, res, next) {
  try {
    res.json({ ok: true, data: await service.updateControls(parseId(req.params.id, 'INVALID_SESSION_ID'), req.body || {}, req.user) });
  } catch (error) { next(error); }
}

async function close(req, res, next) {
  try {
    res.json({ ok: true, data: await service.closeSession(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user) });
  } catch (error) { next(error); }
}

async function reopen(req, res, next) {
  try {
    res.json({ ok: true, data: await service.reopenSession(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user) });
  } catch (error) { next(error); }
}

async function live(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getLiveSession(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user) });
  } catch (error) { next(error); }
}

async function navigate(req, res, next) {
  try {
    res.json({ ok: true, data: await service.navigateGuided(parseId(req.params.id, 'INVALID_SESSION_ID'), req.body || {}, req.user) });
  } catch (error) { next(error); }
}

async function results(req, res, next) {
  try {
    res.json({ ok: true, data: await service.adminResults(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user) });
  } catch (error) { next(error); }
}

async function applicationResult(req, res, next) {
  try {
    res.json({
      ok: true,
      data: await service.adminApplicationResult(
        parseId(req.params.id, 'INVALID_SESSION_ID'),
        parseId(req.params.applicationId, 'INVALID_APPLICATION_ID'),
        req.user
      )
    });
  } catch (error) { next(error); }
}

async function adminSendEmail(req, res, next) {
  try {
    res.status(201).json({
      ok: true,
      data: await service.adminSendEmail(
        parseId(req.params.id, 'INVALID_SESSION_ID'),
        parseId(req.params.applicationId, 'INVALID_APPLICATION_ID'),
        req.body?.email,
        req.user
      )
    });
  } catch (error) { next(error); }
}

async function emailHistory(req, res, next) {
  try {
    res.json({
      ok: true,
      data: { envios: await service.listEmailSends(parseId(req.params.id, 'INVALID_SESSION_ID'), req.user) }
    });
  } catch (error) { next(error); }
}

async function retryEmail(req, res, next) {
  try {
    res.json({
      ok: true,
      data: await service.retryEmail(
        parseId(req.params.id, 'INVALID_SESSION_ID'),
        parseId(req.params.sendId, 'INVALID_EMAIL_SEND_ID'),
        req.user
      )
    });
  } catch (error) { next(error); }
}

async function joinInfo(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getJoinInfo(req.params.codigo) });
  } catch (error) { next(error); }
}

async function join(req, res, next) {
  try {
    const data = await service.joinSession(req.params.codigo, req.body || {}, applicationToken(req));
    res.status(data.reanudada ? 200 : 201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function participantState(req, res, next) {
  try {
    res.json({ ok: true, data: await service.participantState(applicationToken(req)) });
  } catch (error) { next(error); }
}

async function participantStart(req, res, next) {
  try {
    res.json({ ok: true, data: await service.startParticipation(applicationToken(req)) });
  } catch (error) { next(error); }
}

async function participantQuestion(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getParticipantQuestion(applicationToken(req), req.query.orden) });
  } catch (error) { next(error); }
}

async function participantAnswer(req, res, next) {
  try {
    res.json({
      ok: true,
      data: await service.saveAnswer(
        applicationToken(req),
        parseId(req.params.questionId, 'INVALID_QUESTION_ID'),
        req.body?.valor
      )
    });
  } catch (error) { next(error); }
}

async function participantFinish(req, res, next) {
  try {
    res.json({ ok: true, data: await service.finishParticipation(applicationToken(req)) });
  } catch (error) { next(error); }
}

async function participantResults(req, res, next) {
  try {
    res.json({ ok: true, data: await service.participantResult(applicationToken(req)) });
  } catch (error) { next(error); }
}

async function participantRestart(req, res, next) {
  try {
    res.json({ ok: true, data: await service.restartParticipation(applicationToken(req)) });
  } catch (error) { next(error); }
}

async function participantEmail(req, res, next) {
  try {
    res.status(201).json({
      ok: true,
      data: await service.participantSendEmail(applicationToken(req), req.body?.email)
    });
  } catch (error) { next(error); }
}

module.exports = {
  evaluationOptions,
  list,
  get,
  create,
  update,
  remove,
  controls,
  close,
  reopen,
  live,
  navigate,
  results,
  applicationResult,
  adminSendEmail,
  emailHistory,
  retryEmail,
  joinInfo,
  join,
  participantState,
  participantStart,
  participantQuestion,
  participantAnswer,
  participantFinish,
  participantResults,
  participantRestart,
  participantEmail
};
