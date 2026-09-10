const crypto = require('crypto');
const fs = require('fs');

function ensureCsrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  // Multipart upload is parsed by Multer first, so that route calls
  // verifyCsrf after upload.single().
  if (req.method === 'POST' && req.is('multipart/form-data')) return next();

  if (req.method === 'POST') {
    const supplied = req.body && req.body.csrfToken;
    if (!supplied || supplied.length !== 64 || supplied !== req.session.csrfToken) {
      return res.status(403).send('Invalid security token. Please go back and try again.');
    }
  }
  next();
}

function verifyCsrf(req, res, next) {
  const supplied = req.body && req.body.csrfToken;
  if (!supplied || supplied.length !== 64 || supplied !== req.session.csrfToken) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res.status(403).send('Invalid security token. Please go back and try again.');
  }
  next();
}

module.exports = { ensureCsrf, verifyCsrf };
