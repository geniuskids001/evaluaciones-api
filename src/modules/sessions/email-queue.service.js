const { CloudTasksClient } = require('@google-cloud/tasks');
const { OAuth2Client } = require('google-auth-library');
const { AppError } = require('../../utils/app-error');

const taskClient = new CloudTasksClient();
const oidcClient = new OAuth2Client();

function isQueueEnabled() {
  return String(process.env.EMAIL_QUEUE_ENABLED || '').toLowerCase() === 'true';
}

function queueConfig() {
  return {
    projectId: process.env.CLOUD_TASKS_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.CLOUD_TASKS_LOCATION,
    queueId: process.env.CLOUD_TASKS_QUEUE_ID,
    workerUrl: process.env.CLOUD_TASKS_WORKER_URL,
    audience: process.env.CLOUD_TASKS_WORKER_AUDIENCE,
    serviceAccountEmail: process.env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL
  };
}

function assertConfigured() {
  const config = queueConfig();
  if (Object.values(config).some((value) => !value)) {
    throw new AppError(503, 'EMAIL_QUEUE_NOT_CONFIGURED', 'La cola de envíos todavía no está configurada.');
  }
  return config;
}

async function enqueueEmailTask(idSend) {
  const config = assertConfigured();
  const parent = taskClient.queuePath(config.projectId, config.location, config.queueId);
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: config.workerUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ id_envio: Number(idSend) })).toString('base64'),
      oidcToken: {
        serviceAccountEmail: config.serviceAccountEmail,
        audience: config.audience
      }
    }
  };

  await taskClient.createTask({ parent, task });
}

async function verifyCloudTaskRequest(req, res, next) {
  try {
    const config = assertConfigured();
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new Error('Missing bearer token');

    const ticket = await oidcClient.verifyIdToken({
      idToken: match[1],
      audience: config.audience
    });
    const payload = ticket.getPayload();
    if (payload?.email !== config.serviceAccountEmail || payload?.email_verified !== true) {
      throw new Error('Unexpected task identity');
    }
    next();
  } catch {
    next(new AppError(401, 'INVALID_EMAIL_TASK_AUTH', 'La tarea no está autorizada.'));
  }
}

module.exports = {
  isQueueEnabled,
  assertConfigured,
  enqueueEmailTask,
  verifyCloudTaskRequest
};
