const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { createServer, getCsrf, login, createFaculty, createDept, createUser, uploadsDir } = require('./helpers');

let uid, facultyId, deptId, ownerA, ownerB, fileName, resourceId, server;

test('lecturer cannot delete another uploader resource', async () => {
  uid = Date.now();
  facultyId = createFaculty(`Delete Faculty ${uid}`);
  deptId = createDept(`Delete Dept ${uid}`, facultyId);

  ownerA = createUser({ name: `Owner A ${uid}`, email: `owner.a.${uid}@example.com`, deptId });
  ownerB = createUser({ name: `Owner B ${uid}`, email: `owner.b.${uid}@example.com`, deptId });

  fileName = `test-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadsDir, fileName), 'test content');
  resourceId = db.prepare(
    `INSERT INTO resources (title, course_id, file_name, original_name, file_size, uploaded_by, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run('Shared Resource', fileName, fileName, 12, ownerA).lastInsertRowid;

  server = await createServer();
  const cookie = await login(server, `owner.b.${uid}@example.com`, 'password123');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(`${base}/login`, { headers: { 'Cookie': cookie } });
  const token = getCsrf(await page.text());
  const res = await fetch(`${base}/resources/${resourceId}/delete`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
    body: new URLSearchParams({ csrfToken: token }).toString()
  });
  assert.equal(res.status, 302);
  const stillExists = db.prepare('SELECT id FROM resources WHERE id = ?').get(resourceId);
  assert.ok(stillExists, 'resource must survive a non-owner delete attempt');
});

test('lecturer can delete their own resource', async () => {
  const cookie = await login(server, `owner.a.${uid}@example.com`, 'password123');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(`${base}/login`, { headers: { 'Cookie': cookie } });
  const token = getCsrf(await page.text());
  const res = await fetch(`${base}/resources/${resourceId}/delete`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
    body: new URLSearchParams({ csrfToken: token }).toString()
  });
  assert.equal(res.status, 302);
  const gone = db.prepare('SELECT id FROM resources WHERE id = ?').get(resourceId);
  assert.equal(gone, undefined, 'owner should be able to delete their own resource');
});

test.after(async () => {
  if (server) server.close();
  fs.rmSync(path.join(uploadsDir, fileName), { force: true });
  db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(ownerA, ownerB);
  db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);
  db.prepare('DELETE FROM faculties WHERE id = ?').run(facultyId);
});
