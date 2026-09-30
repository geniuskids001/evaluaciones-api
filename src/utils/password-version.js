const crypto = require('crypto');

function passwordVersion(passwordHash) {
  if (!passwordHash) return null;
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 24);
}

module.exports = { passwordVersion };
