const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createServer, login, createFaculty, createDept, uploadsDir } = require('./helpers');

test('student cannot download resources outside their eligible departments', async () => {
  const uid = Date.now();
  const facultyId = createFaculty(`Test Faculty ${uid}`);
  const deptAId = createDept(`Dept A ${uid}`, facultyId);
  const deptBId = createDept(`Dept B ${uid}`, facultyId);
  const course = db.prepare('INSERT INTO courses (code, title, owner_department_id) VALUES (?, ?, ?)').run(`TST${uid}`, 'Test Course', deptAId);
  db.prepare('INSERT INTO course_departments (course_id, department_id) VALUES (?, ?)').run(course.lastInsertRowid, deptAId);

  const studentEmail = `test.student.${Date.now()}@example.com`;
  const student = db.prepare(
    `INSERT INTO users (full_name, email, password, department_id, department, role, account_type, email_verified)
     VALUES (?, ?, ?, ?, ?, 'student', 'student', 1)`
  ).run(
    'Test Student',
    studentEmail,
    bcrypt.hashSync('password123', 12),
    deptBId,
    `Dept B ${uid}`
  );

  const fileName = `test-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadsDir, fileName), 'test content');
  const resource = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`
  ).run('Restricted Material', course.lastInsertRowid, fileName, fileName, 12);

  const server = await createServer();
  try {
    const { port } = server.address();
    const cookie = await login(server, studentEmail, 'password123');
    const res = await fetch(`http://127.0.0.1:${port}/resources/${resource.lastInsertRowid}/download`, {
      redirect: 'manual',
      headers: { 'Cookie': cookie }
    });
    assert.equal(res.status, 302, 'ineligible student should be redirected, not given the file');
    const location = res.headers.get('location') || '';
    assert.match(location, /\/dashboard/);
    assert.ok(!res.headers.get('content-disposition'), 'no file should be sent');
  } finally {
    server.close();
  }

  // Cleanup
  fs.rmSync(path.join(uploadsDir, fileName), { force: true });
  db.prepare('DELETE FROM resources WHERE id = ?').run(resource.lastInsertRowid);
  db.prepare('DELETE FROM users WHERE id = ?').run(student.lastInsertRowid);
  db.prepare('DELETE FROM course_departments WHERE course_id = ?').run(course.lastInsertRowid);
  db.prepare('DELETE FROM courses WHERE id = ?').run(course.lastInsertRowid);
  db.prepare('DELETE FROM departments WHERE id IN (?, ?)').run(deptAId, deptBId);
  db.prepare('DELETE FROM faculties WHERE id = ?').run(facultyId);
});
