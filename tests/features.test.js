const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { createServer, login, authorizationToken, createUser, createDept, createFaculty, uploadsDir } = require('./helpers');

function uploadedFile(name = 'note.txt') {
  const fileName = `test-${Date.now()}-${name}`;
  fs.writeFileSync(path.join(uploadsDir, fileName), 'test content');
  return fileName;
}

test('admin can view analytics page', async () => {
  const faculty = createFaculty(`AN Faculty ${Date.now()}`);
  const dept = createDept(`AN Dept ${Date.now()}`, faculty);
  const teacher = `an.admin.${Date.now()}@example.com`;
  createUser({ name: 'AN Admin', email: teacher, accountType: 'administrator', deptId: dept });
  const server = await createServer();
  try {
    const cookie = await login(server, teacher, 'password123');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/admin/analytics`, { headers: { 'Cookie': cookie } });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Platform Analytics/);
  } finally {
    server.close();
    db.prepare('DELETE FROM users WHERE email = ?').run(teacher);
    db.prepare('DELETE FROM departments WHERE id = ?').run(dept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});

test('lecturer can edit their own resource metadata', async () => {
  const faculty = createFaculty(`ED Faculty ${Date.now()}`);
  const dept = createDept(`ED Dept ${Date.now()}`, faculty);
  const teacher = `ed.owner.${Date.now()}@example.com`;
  const userId = createUser({ name: 'ED Owner', email: teacher, accountType: 'lecturer', deptId: dept });
  const fileName = uploadedFile();
  const resourceId = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run('Original Title', fileName, fileName, 12, userId).lastInsertRowid;

  const server = await createServer();
  try {
    const cookie = await login(server, teacher, 'password123');
    const token = await authorizationToken(server, cookie);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/resources/${resourceId}/edit`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
      body: new URLSearchParams({
        csrfToken: token,
        title: 'Updated Title',
        description: 'Edited description',
        level: '300 Level',
        semester: 'First Semester',
        academic_session: '2026/2027'
      }).toString()
    });
    assert.equal(res.status, 302);
    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    assert.equal(row.title, 'Updated Title');
    assert.equal(row.description, 'Edited description');
    assert.equal(row.level, '300 Level');
  } finally {
    server.close();
    fs.rmSync(path.join(uploadsDir, fileName), { force: true });
    db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resourceId);
    db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('DELETE FROM departments WHERE id = ?').run(dept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});

test('academic structure: add faculty, department and course', async () => {
  const admin = `ac.admin.${Date.now()}@example.com`;
  createUser({ name: 'AC Admin', email: admin, accountType: 'administrator' });
  const server = await createServer();
  const cookie = await login(server, admin, 'password123');
  const base = `http://127.0.0.1:${server.address().port}`;
  let courseId = null, deptId = null, facultyId = null;
  try {
    const token = await authorizationToken(server, cookie);
    const send = (route, data) => fetch(`${base}${route}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
      body: new URLSearchParams({ csrfToken: token, ...data }).toString()
    });

    const facName = `Faculty ${Date.now()}`;
    await send('/admin/academics/faculties', { name: facName });
    facultyId = db.prepare('SELECT id FROM faculties WHERE name = ?').get(facName).id;

    const deptName = `Dept ${Date.now()}`;
    await send('/admin/academics/departments', { name: deptName, faculty_id: String(facultyId) });
    deptId = db.prepare('SELECT id FROM departments WHERE name = ?').get(deptName).id;

    const courseCode = `CSC${Date.now() % 100000}`;
    await send('/admin/academics/courses', {
      code: courseCode, title: 'Test Course', owner_department_id: String(deptId), level: '100 Level'
    });

    const course = db.prepare('SELECT * FROM courses WHERE code = ?').get(courseCode);
    assert.ok(course, 'course should be created');
    assert.equal(course.title, 'Test Course');
    assert.equal(course.owner_department_id, deptId);
    // owning department should automatically be granted access
    const access = db.prepare('SELECT * FROM course_departments WHERE course_id = ? AND department_id = ?')
      .get(course.id, deptId);
    assert.ok(access, 'owner department should be added to course access automatically');
  } finally {
    if (courseId) db.prepare('DELETE FROM course_departments WHERE course_id = ?').run(courseId);
    if (courseId) db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    if (deptId) db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);
    if (facultyId) db.prepare('DELETE FROM faculties WHERE id = ?').run(facultyId);
    server.close();
    db.prepare('DELETE FROM users WHERE email = ?').run(admin);
  }
});

test('password reset flow issues a valid reset link', async () => {
  const studentEmail = `pr.student.${Date.now()}@example.com`;
  const userId = createUser({ name: 'PR Student', email: studentEmail, accountType: 'student' });
  const server = await createServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = await fetch(`${base}/forgot-password`);
    const token = getCsrfFor(await get.text());
    const res = await fetch(`${base}/forgot-password`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': get.headers.getSetCookie().join('; ') },
      body: new URLSearchParams({ csrfToken: token, email: studentEmail }).toString()
    });
    assert.equal(res.status, 200);
    // reset_token should be hashed (64-hex sha256) and set with an expiry
    const row = db.prepare('SELECT reset_token, reset_expires FROM users WHERE id = ?').get(userId);
    assert.match(row.reset_token, /^[0-9a-f]{64}$/);
    assert.ok(new Date(row.reset_expires) > new Date());
  } finally {
    server.close();
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});

// send form without asserting CSRF token presence (helper for forgot-password page)
function getCsrfFor(html) {
  const m = html.match(/name="csrfToken"\s+value="([0-9a-f]{64})"/);
  if (!m) throw new Error('CSRF token not found');
  return m[1];
}

test('lecturer can upload a file (multipart)', async () => {
  const faculty = createFaculty(`UP Faculty ${Date.now()}`);
  const dept = createDept(`UP Dept ${Date.now()}`, faculty);
  const teacher = `up.owner.${Date.now()}@example.com`;
  const lecturerId = createUser({ name: 'UP Owner', email: teacher, accountType: 'lecturer', deptId: dept });
  const courseId = db.prepare('INSERT INTO courses (code, title, owner_department_id, level) VALUES (?,?,?,?)')
    .run(`UP${Date.now() % 100000}`, 'Upload Test Course', dept, '100 Level').lastInsertRowid;

  const server = await createServer();
  let resourceId = null, fileOnDisk = null;
  try {
    const cookie = await login(server, teacher, 'password123');
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/upload`, { headers: { 'Cookie': cookie } });
    const token = getCsrfFor(await page.text());

    const form = new FormData();
    form.append('csrfToken', token);
    form.append('title', 'Uploaded Note Title');
    form.append('course_id', String(courseId));
    form.append('level', '100 Level');
    form.append('semester', 'First Semester');
    form.append('academic_session', '2026/2027');
    form.append('category_id', '1');
    form.append('description', 'Created by integration test');
    form.append('file', new Blob(['test content'], { type: 'text/plain' }), 'note.txt');

    const res = await fetch(`${base}/upload`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Cookie': cookie },
      body: form
    });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /\/dashboard/);

    const row = db.prepare('SELECT * FROM resources WHERE description = ?').get('Created by integration test');
    assert.ok(row, 'resource row should be created');
    resourceId = row.id;
    assert.equal(row.title, 'Uploaded Note Title');
    assert.equal(row.course_id, courseId);
    assert.equal(row.uploaded_by, lecturerId);
    assert.equal(row.file_size, 12);

    fileOnDisk = path.join(uploadsDir, row.file_name);
    assert.ok(fs.existsSync(fileOnDisk), 'file should be saved in uploads');
    assert.equal(fs.readFileSync(fileOnDisk, 'utf8'), 'test content');
  } finally {
    server.close();
    if (fileOnDisk) fs.rmSync(fileOnDisk, { force: true });
    if (resourceId) db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resourceId);
    if (resourceId) db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    db.prepare('DELETE FROM course_departments WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    db.prepare('DELETE FROM users WHERE id = ?').run(lecturerId);
    db.prepare('DELETE FROM departments WHERE id = ?').run(dept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});

test('students cannot upload resources', async () => {
  const studentEmail = `up.student.${Date.now()}@example.com`;
  const studentId = createUser({ name: 'UP Student', email: studentEmail, accountType: 'student', emailVerified: true });
  const server = await createServer();
  try {
    const cookie = await login(server, studentEmail, 'password123');
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = await fetch(`${base}/upload`, { headers: { 'Cookie': cookie }, redirect: 'manual' });
    assert.equal(get.status, 302);
    assert.match(get.headers.get('location'), /\/dashboard/);
  } finally {
    server.close();
    db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
  }
});

test('lecturer can replace the file of an existing resource', async () => {
  const faculty = createFaculty(`RF Faculty ${Date.now()}`);
  const dept = createDept(`RF Dept ${Date.now()}`, faculty);
  const teacher = `rf.owner.${Date.now()}@example.com`;
  const userId = createUser({ name: 'RF Owner', email: teacher, accountType: 'lecturer', deptId: dept });
  const oldFileName = uploadedFile('old.txt');
  const resourceId = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run('Original Title', oldFileName, 'old.txt', 12, userId).lastInsertRowid;

  const server = await createServer();
  let newFileOnDisk = null;
  try {
    const cookie = await login(server, teacher, 'password123');
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/resources/${resourceId}/edit`, { headers: { 'Cookie': cookie } });
    const token = getCsrfFor(await page.text());

    const form = new FormData();
    form.append('csrfToken', token);
    form.append('title', 'Updated With File');
    form.append('file', new Blob(['new content 12345'], { type: 'text/plain' }), 'new.txt');

    const res = await fetch(`${base}/resources/${resourceId}/edit`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Cookie': cookie },
      body: form
    });
    assert.equal(res.status, 302);

    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    assert.equal(row.original_name, 'new.txt');
    assert.notEqual(row.file_name, oldFileName);

    newFileOnDisk = path.join(uploadsDir, row.file_name);
    assert.ok(fs.existsSync(newFileOnDisk), 'replacement file should exist on disk');
    assert.equal(fs.readFileSync(newFileOnDisk, 'utf8'), 'new content 12345');
    assert.ok(!fs.existsSync(path.join(uploadsDir, oldFileName)), 'old file should be removed');
  } finally {
    server.close();
    if (newFileOnDisk) fs.rmSync(newFileOnDisk, { force: true });
    fs.rmSync(path.join(uploadsDir, oldFileName), { force: true });
    db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resourceId);
    db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('DELETE FROM departments WHERE id = ?').run(dept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});

test('account locks after repeated failed login attempts', async () => {
  const studentEmail = `lk.student.${Date.now()}@example.com`;
  const userId = createUser({ name: 'LK Student', email: studentEmail, accountType: 'student', emailVerified: true });
  const server = await createServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Pre-set 4 failed attempts so the next failure triggers lockout
    db.prepare('UPDATE users SET failed_login_attempts = 4 WHERE id = ?').run(userId);

    const get = await fetch(`${base}/login`);
    const token = getCsrfFor(await get.text());
    const cookie = get.headers.getSetCookie().join('; ');

    await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
      body: new URLSearchParams({ email: studentEmail, password: 'wrongpass', csrfToken: token }).toString()
    });

    const row = db.prepare('SELECT failed_login_attempts, lockout_until FROM users WHERE id = ?').get(userId);
    assert.equal(row.failed_login_attempts, 0, 'counter should reset when lockout is issued');
    assert.ok(row.lockout_until, 'user should be locked out');
    assert.ok(new Date(row.lockout_until) > new Date(), 'lockout should be in the future');

    const lockoutGet = await fetch(`${base}/login`);
    const lockoutToken = getCsrfFor(await lockoutGet.text());
    const lockoutCookie = lockoutGet.headers.getSetCookie().join('; ');
    const res = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': lockoutCookie },
      body: new URLSearchParams({ email: studentEmail, password: 'password123', csrfToken: lockoutToken }).toString()
    });
    const body = await res.text();
    assert.match(body, /locked/i);
  } finally {
    server.close();
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});