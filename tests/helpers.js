const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const app = require('../server');

const uploadsDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'uploads');

async function createServer() {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return server;
}

function getCsrf(html) {
  const m = html.match(/name="csrfToken"\s+value="([0-9a-f]{64})"/);
  if (!m) throw new Error('CSRF token not found on page');
  return m[1];
}

async function login(server, email, password) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = await fetch(`${base}/login`);
  const token = getCsrf(await get.text());
  const pre = get.headers.getSetCookie().join('; ');
  const post = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': pre },
    body: new URLSearchParams({ email, password, csrfToken: token }).toString()
  });
  // Login regenerates the session; only the cookie it issues is valid.
  return post.headers.getSetCookie().join('; ');
}

async function authorizationToken(server, cookie) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/login`, { headers: { 'Cookie': cookie } });
  return getCsrf(await page.text());
}

function createUser({ name, email, accountType = 'lecturer', deptId = null, password = 'password123', emailVerified }) {
  const verified = emailVerified !== undefined ? emailVerified : (accountType === 'lecturer' || accountType === 'administrator');
  const canManageUsers = accountType === 'administrator' ? 1 : 0;
  return db.prepare(
    `INSERT INTO users (full_name, email, password, department_id, role, account_type, email_verified, can_manage_users)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    email,
    bcrypt.hashSync(password, 12),
    deptId,
    accountType === 'student' ? 'student' : 'admin',
    accountType,
    verified ? 1 : 0,
    canManageUsers
  ).lastInsertRowid;
}

function createDept(name, facultyId) {
  return db.prepare('INSERT INTO departments (name, faculty_id) VALUES (?, ?)').run(name, facultyId).lastInsertRowid;
}

function createFaculty(name) {
  return db.prepare("INSERT INTO faculties (name) VALUES (?)").run(name).lastInsertRowid;
}

module.exports = { createServer, getCsrf, login, authorizationToken, createUser, createDept, createFaculty, uploadsDir };