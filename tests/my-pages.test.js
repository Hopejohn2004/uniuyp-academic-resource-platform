const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { createServer, login, createUser, createDept, createFaculty } = require('./helpers');

test('lecturer can view their own uploads page', async () => {
  const faculty = createFaculty(`MU Faculty ${Date.now()}`);
  const dept = createDept(`MU Dept ${Date.now()}`, faculty);
  const teacher = `mu.lecturer.${Date.now()}@example.com`;
  const userId = createUser({ name: 'MU Lecturer', email: teacher, accountType: 'lecturer', deptId: dept });
  const resourceId = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run('MU Personal Resource', 'mu-file.txt', 'mu-file.txt', 12, userId).lastInsertRowid;

  const server = await createServer();
  try {
    const cookie = await login(server, teacher, 'password123');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/my-uploads`, { headers: { 'Cookie': cookie } });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /My Uploads/);
    assert.match(body, /MU Personal Resource/);
  } finally {
    server.close();
    db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resourceId);
    db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('DELETE FROM departments WHERE id = ?').run(dept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});

test('students cannot view my-uploads page', async () => {
  const studentEmail = `mu.student.${Date.now()}@example.com`;
  const studentId = createUser({ name: 'MU Student', email: studentEmail, accountType: 'student', emailVerified: true });
  const server = await createServer();
  try {
    const cookie = await login(server, studentEmail, 'password123');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/my-uploads`, { headers: { 'Cookie': cookie }, redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /\/dashboard/);
  } finally {
    server.close();
    db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
  }
});

test('student can view their download history', async () => {
  const faculty = createFaculty(`MD Faculty ${Date.now()}`);
  const dept = createDept(`MD Dept ${Date.now()}`, faculty);
  const studentEmail = `md.student.${Date.now()}@example.com`;
  const studentId = createUser({ name: 'MD Student', email: studentEmail, accountType: 'student', emailVerified: true, deptId: dept });
  const resourceId = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, NULL, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`
  ).run('MD Downloaded Resource', 'md-file.txt', 'md-file.txt', 12).lastInsertRowid;
  db.prepare('INSERT INTO downloads (resource_id, user_id) VALUES (?, ?)').run(resourceId, studentId);

  const server = await createServer();
  try {
    const cookie = await login(server, studentEmail, 'password123');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/my-downloads`, { headers: { 'Cookie': cookie } });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /My Downloads/);
    assert.match(body, /MD Downloaded Resource/);
  } finally {
    server.close();
    db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resourceId);
    db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM departments WHERE id = ?').run(dept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});

test('courses page lists courses and course detail honors department eligibility', async () => {
  const faculty = createFaculty(`CR Faculty ${Date.now()}`);
  const ownerDept = createDept(`CR Owner Dept ${Date.now()}`, faculty);
  const otherDept = createDept(`CR Other Dept ${Date.now()}`, faculty);

  const courseId = db.prepare('INSERT INTO courses (code, title, owner_department_id, level) VALUES (?,?,?,?)')
    .run(`CR${Date.now() % 100000}`, 'Course Detail Test', ownerDept, '200 Level').lastInsertRowid;
  db.prepare('INSERT INTO course_departments (course_id, department_id) VALUES (?, ?)').run(courseId, ownerDept);
  db.prepare('INSERT INTO course_departments (course_id, department_id) VALUES (?, ?)').run(courseId, otherDept);

  const resourceId = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`
  ).run('Course Resource', courseId, 'cr-file.txt', 'cr-file.txt', 12).lastInsertRowid;

  // eligible student (otherDept) can see the course and its resource
  const studentEmail = `cr.student.${Date.now()}@example.com`;
  createUser({ name: 'CR Student', email: studentEmail, accountType: 'student', emailVerified: true, deptId: otherDept });
  // ineligible student cannot see the resource
  const strangerEmail = `cr.stranger.${Date.now()}@example.com`;
  createUser({ name: 'CR Stranger', email: strangerEmail, accountType: 'student', emailVerified: true, deptId: null });

  const server = await createServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cookie = await login(server, studentEmail, 'password123');
    const list = await fetch(`${base}/courses`, { headers: { 'Cookie': cookie } });
    const listBody = await list.text();
    assert.equal(list.status, 200);
    assert.match(listBody, /<h1>Courses<\/h1>/);
    assert.match(listBody, new RegExp(`/courses/${courseId}`));

    const detail = await fetch(`${base}/courses/${courseId}`, { headers: { 'Cookie': cookie } });
    const detailBody = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(detailBody, /Course Resource/);

    const strangerCookie = await login(server, strangerEmail, 'password123');
    const strangerDetail = await fetch(`${base}/courses/${courseId}`, { headers: { 'Cookie': strangerCookie } });
    assert.equal(strangerDetail.status, 200);
    const strangerBody = await strangerDetail.text();
    assert.doesNotMatch(strangerBody, /Course Resource/);

    const dashboard = await fetch(`${base}/dashboard`, { headers: { 'Cookie': cookie } });
    const dashboardBody = await dashboard.text();
    assert.match(dashboardBody, new RegExp(`/courses/${courseId}`));
  } finally {
    server.close();
    db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resourceId);
    db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    db.prepare('DELETE FROM course_departments WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    db.prepare('DELETE FROM users WHERE email = ?').run(studentEmail);
    db.prepare('DELETE FROM users WHERE email = ?').run(strangerEmail);
    db.prepare('DELETE FROM departments WHERE id = ?').run(ownerDept);
    db.prepare('DELETE FROM departments WHERE id = ?').run(otherDept);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(faculty);
  }
});
