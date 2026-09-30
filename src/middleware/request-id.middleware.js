const crypto = require('crypto');

function requestId(req, res, next) {
  const incoming = req.header('X-Request-Id');
  req.requestId = incoming && incoming.length <= 100 ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestId;
