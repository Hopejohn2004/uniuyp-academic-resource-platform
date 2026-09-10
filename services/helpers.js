function absoluteUrl(req, route, baseUrl) {
  return `${baseUrl || `${req.protocol}://${req.get('host')}`}${route}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

function accountLabel(type, isPrimaryAdmin = false) {
  if (isPrimaryAdmin) return 'Primary Administrator';
  if (type === 'administrator') return 'Administrator-Lecturer';
  if (type === 'lecturer') return 'Lecturer';
  return 'Student';
}

module.exports = {
  absoluteUrl,
  normalizeEmail,
  validPassword,
  accountLabel
};
