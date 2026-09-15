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

function getDepartments(db) {
  return db.prepare(
    `SELECT d.id, d.name, d.faculty_id, f.name AS faculty_name
     FROM departments d JOIN faculties f ON f.id = d.faculty_id
     ORDER BY f.name, d.name`
  ).all();
}

module.exports = {
  absoluteUrl,
  normalizeEmail,
  validPassword,
  accountLabel,
  getDepartments
};
