const express = require('express');
const bcrypt = require('bcryptjs');

module.exports = function createAdminRoutes(config) {
  const { db, requireLogin, requireSuperAdmin, normalizeEmail, validPassword, accountLabel } = config;
  const router = express.Router();

  function getTargetUser(id) {
    return db.prepare('SELECT id, full_name, account_type, can_manage_users, is_primary_admin FROM users WHERE id = ?').get(id);
  }



  function getFaculties() {
    return db.prepare('SELECT * FROM faculties ORDER BY name').all();
  }

  // ==============================
  //  ADMIN USER MANAGEMENT
  // ==============================

  router.get('/admin/users', requireLogin, requireSuperAdmin, (req, res) => {
    const q = String(req.query.q || '').trim();
    const facultyId = parseInt(req.query.faculty_id, 10) || null;
    const departmentId = parseInt(req.query.department_id, 10) || null;
    const accountType = ['student', 'lecturer', 'administrator'].includes(req.query.account_type)
      ? req.query.account_type : '';
    let page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;

    let where = ' WHERE 1=1';
    const params = [];
    if (q) {
      where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.registration_number LIKE ? OR u.staff_id LIKE ? OR u.matric_or_staff_no LIKE ?)';
      const x = `%${q}%`;
      params.push(x, x, x, x, x);
    }
    if (facultyId) { where += ' AND u.faculty_id = ?'; params.push(facultyId); }
    if (departmentId) { where += ' AND u.department_id = ?'; params.push(departmentId); }

    const baseSelect = `SELECT u.*, f.name faculty_name, d.name department_name
                        FROM users u
                        LEFT JOIN faculties f ON f.id = u.faculty_id
                        LEFT JOIN departments d ON d.id = u.department_id`;

    // Staff (lecturers/administrators)
    const showStaff = accountType === '' || accountType === 'lecturer' || accountType === 'administrator';
    let staff = [], staffTotal = 0, staffTotalPages = 1;
    if (showStaff) {
      const sw = `${where} AND u.account_type IN ('lecturer','administrator')`;
      staffTotal = db.prepare(`SELECT COUNT(*) c FROM users u${sw}`).get(...params).c;
      staffTotalPages = Math.max(1, Math.ceil(staffTotal / pageSize));
      page = Math.min(page, staffTotalPages);
      const offset = (page - 1) * pageSize;
      staff = db.prepare(
        `${baseSelect}${sw} ORDER BY CASE WHEN u.is_primary_admin = 1 THEN 0 ELSE 1 END, u.full_name COLLATE NOCASE LIMIT ? OFFSET ?`
      ).all(...params, pageSize, offset);
    }

    // Students grouped by department, paginated
    const showStudents = accountType === '' || accountType === 'student';
    let studentGroups = [], studentTotal = 0, studentTotalPages = 1, spage = 1;
    if (showStudents) {
      const sw = `${where} AND u.account_type = 'student'`;
      studentTotal = db.prepare(`SELECT COUNT(*) c FROM users u${sw}`).get(...params).c;
      studentTotalPages = Math.max(1, Math.ceil(studentTotal / pageSize));
      spage = Math.min(Math.max(1, parseInt(req.query.spage, 10) || 1), studentTotalPages);
      const offset = (spage - 1) * pageSize;
      const students = db.prepare(
        `${baseSelect}${sw} ORDER BY d.name COLLATE NOCASE, u.full_name COLLATE NOCASE LIMIT ? OFFSET ?`
      ).all(...params, pageSize, offset);
      const map = new Map();
      for (const s of students) {
        const key = s.department_name || 'No Department Assigned';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
      }
      studentGroups = [...map.entries()].map(([name, list]) => ({ name, students: list }));
    }

    res.render('admin_users', {
      staff, staffTotal, staffTotalPages, studentGroups, studentTotal, studentTotalPages, spage,
      showStaff, showStudents,
      faculties: getFaculties(), departments: config.getDepartments(),
      q, facultyId, departmentId, accountType, page
    });
  });

  router.post('/admin/users', requireLogin, requireSuperAdmin, (req, res) => {
    const full_name = String(req.body.full_name || '').trim();
    const password = req.body.password;
    const email = normalizeEmail(req.body.email);
    const accountType = req.body.account_type;
    const departmentId = parseInt(req.body.department_id, 10) || null;
    const identifier = String(req.body.identifier || '').trim();
    const department = departmentId ? db.prepare('SELECT * FROM departments WHERE id = ?').get(departmentId) : null;

    if (!full_name || !email || !password || !department || !['student', 'lecturer', 'administrator'].includes(accountType) || !identifier) {
      req.flash('error', 'Please fill in all required fields.');
      return res.redirect('/admin/users');
    }
    if (!validPassword(password)) {
      req.flash('error', 'Password must be at least 8 characters long.');
      return res.redirect('/admin/users');
    }
    if (accountType === 'administrator' && req.session.user.accountType !== 'administrator') {
      req.flash('error', 'Only an Administrator can create another Administrator.');
      return res.redirect('/admin/users');
    }
    if (db.prepare('SELECT id FROM users WHERE email = ? OR registration_number = ? OR staff_id = ?').get(email, identifier, identifier)) {
      req.flash('error', 'An account with that email or ID already exists.');
      return res.redirect('/admin/users');
    }

    const manage = accountType === 'administrator' ? 1 : 0;
    const legacyRole = accountType === 'student' ? 'student' : 'admin';
    const reg = accountType === 'student' ? identifier : null;
    const staff = accountType !== 'student' ? identifier : null;

    db.prepare(
      `INSERT INTO users(full_name, matric_or_staff_no, registration_number, staff_id, email, password, department, department_id, faculty_id, role, account_type, can_manage_users, is_primary_admin, email_verified)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`
    ).run(full_name, identifier, reg, staff, email, bcrypt.hashSync(password, 12), department.name, department.id, department.faculty_id, legacyRole, accountType, manage);

    req.flash('success', `Account for "${full_name}" created as ${accountLabel(accountType)}.`);
    res.redirect('/admin/users');
  });

  router.post('/admin/users/:id/update', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) {
      req.flash('error', 'User account not found.');
      return res.redirect('/admin/users');
    }
    if (target.is_primary_admin && !req.session.user.isPrimaryAdmin) {
      req.flash('error', 'The Primary Administrator is protected.');
      return res.redirect('/admin/users');
    }

    const full_name = String(req.body.full_name || '').trim();
    const email = normalizeEmail(req.body.email);
    const accountType = req.body.account_type;
    const departmentId = parseInt(req.body.department_id, 10) || null;
    const identifier = String(req.body.identifier || '').trim();
    const department = departmentId ? db.prepare('SELECT * FROM departments WHERE id = ?').get(departmentId) : null;

    if (!full_name || !email || !department || !identifier || !['student', 'lecturer', 'administrator'].includes(accountType)) {
      req.flash('error', 'Invalid user details.');
      return res.redirect('/admin/users');
    }
    if (db.prepare('SELECT id FROM users WHERE id <> ? AND (email = ? OR registration_number = ? OR staff_id = ?)').get(id, email, identifier, identifier)) {
      req.flash('error', 'That email or ID is already used by another account.');
      return res.redirect('/admin/users');
    }

    const manage = accountType === 'administrator' ? 1 : 0;
    const legacyRole = accountType === 'student' ? 'student' : 'admin';
    const reg = accountType === 'student' ? identifier : null;
    const staff = accountType !== 'student' ? identifier : null;

    db.prepare(
      `UPDATE users SET full_name = ?, email = ?, matric_or_staff_no = ?, registration_number = ?, staff_id = ?, department = ?, department_id = ?, faculty_id = ?, role = ?, account_type = ?, can_manage_users = ? WHERE id = ?`
    ).run(full_name, email, identifier, reg, staff, department.name, department.id, department.faculty_id, legacyRole, accountType, manage, id);

    req.flash('success', 'User details updated.');
    res.redirect('/admin/users');
  });

  router.post('/admin/users/:id/role', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const accountType = req.body.account_type;
    const target = getTargetUser(id);
    if (!target) {
      req.flash('error', 'User account not found.');
      return res.redirect('/admin/users');
    }
    if (id === req.session.user.id || (target.is_primary_admin && !req.session.user.isPrimaryAdmin)) {
      req.flash('error', 'That account is protected from this change.');
      return res.redirect('/admin/users');
    }
    if (!['student', 'lecturer', 'administrator'].includes(accountType)) {
      req.flash('error', 'Invalid role selected.');
      return res.redirect('/admin/users');
    }
    db.prepare('UPDATE users SET role = ?, account_type = ?, can_manage_users = ? WHERE id = ?')
      .run(accountType === 'student' ? 'student' : 'admin', accountType, accountType === 'administrator' ? 1 : 0, id);
    req.flash('success', 'User role and permissions updated.');
    res.redirect('/admin/users');
  });

  router.post('/admin/users/:id/delete', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = getTargetUser(id);
    if (!target) {
      req.flash('error', 'User account not found.');
      return res.redirect('/admin/users');
    }
    if (id === req.session.user.id || target.is_primary_admin) {
      req.flash('error', 'The Primary Administrator account cannot be deleted.');
      return res.redirect('/admin/users');
    }
    db.prepare('DELETE FROM downloads WHERE user_id = ?').run(id);
    db.prepare('UPDATE resources SET uploaded_by = NULL WHERE uploaded_by = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    req.flash('success', 'User account deleted.');
    res.redirect('/admin/users');
  });

  // ==============================
  //  ADMIN ACADEMIC STRUCTURE
  // ==============================

  router.get('/admin/academics', requireLogin, requireSuperAdmin, (req, res) => {
    const faculties = getFaculties();
    const departments = config.getDepartments();
    const courses = db.prepare(
      `SELECT c.*, d.name owner_department,
              (SELECT group_concat(d2.name, ', ')
               FROM course_departments cd2
               JOIN departments d2 ON d2.id = cd2.department_id
               WHERE cd2.course_id = c.id) offered_departments,
              (SELECT group_concat(cd3.department_id, ',')
               FROM course_departments cd3
               WHERE cd3.course_id = c.id) offered_department_ids
       FROM courses c
       LEFT JOIN departments d ON d.id = c.owner_department_id
       ORDER BY c.code`
    ).all();
    res.render('admin_academics', { faculties, departments, courses });
  });

  // ---- Faculties ----
  router.post('/admin/academics/faculties', requireLogin, requireSuperAdmin, (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) {
      req.flash('error', 'Faculty name is required.');
      return res.redirect('/admin/academics');
    }
    try {
      db.prepare('INSERT INTO faculties(name) VALUES(?)').run(name);
      req.flash('success', 'Faculty added.');
    } catch {
      req.flash('error', 'That faculty already exists.');
    }
    res.redirect('/admin/academics');
  });

  router.post('/admin/academics/faculties/:id/update', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    if (!id || !name) {
      req.flash('error', 'Faculty name is required.');
      return res.redirect('/admin/academics');
    }
    try {
      db.prepare('UPDATE faculties SET name = ? WHERE id = ?').run(name, id);
      req.flash('success', 'Faculty updated.');
    } catch {
      req.flash('error', 'That faculty name already exists.');
    }
    res.redirect('/admin/academics');
  });

  router.post('/admin/academics/faculties/:id/delete', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const faculty = db.prepare('SELECT id FROM faculties WHERE id = ?').get(id);
    if (!faculty) {
      req.flash('error', 'Faculty not found.');
      return res.redirect('/admin/academics');
    }
    const users = db.prepare('SELECT COUNT(*) c FROM users WHERE faculty_id = ?').get(id).c;
    const departments = db.prepare('SELECT COUNT(*) c FROM departments WHERE faculty_id = ?').get(id).c;
    if (users || departments) {
      req.flash('error', 'Cannot delete a faculty that still has departments or users. Move them first.');
      return res.redirect('/admin/academics');
    }
    db.prepare('DELETE FROM faculties WHERE id = ?').run(id);
    req.flash('success', 'Faculty deleted.');
    res.redirect('/admin/academics');
  });

  // ---- Departments ----
  router.post('/admin/academics/departments', requireLogin, requireSuperAdmin, (req, res) => {
    const name = String(req.body.name || '').trim();
    const facultyId = parseInt(req.body.faculty_id, 10);
    if (!name || !facultyId) {
      req.flash('error', 'Department name and faculty are required.');
      return res.redirect('/admin/academics');
    }
    try {
      db.prepare('INSERT INTO departments(name, faculty_id) VALUES(?, ?)').run(name, facultyId);
      req.flash('success', 'Department added.');
    } catch {
      req.flash('error', 'That department already exists in the selected faculty.');
    }
    res.redirect('/admin/academics');
  });

  router.post('/admin/academics/departments/:id/update', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    const facultyId = parseInt(req.body.faculty_id, 10) || null;
    if (!id || !name || !facultyId) {
      req.flash('error', 'Department name and faculty are required.');
      return res.redirect('/admin/academics');
    }
    try {
      db.prepare('UPDATE departments SET name = ?, faculty_id = ? WHERE id = ?').run(name, facultyId, id);
      db.prepare('UPDATE users SET faculty_id = ? WHERE department_id = ?').run(facultyId, id);
      req.flash('success', 'Department updated.');
    } catch {
      req.flash('error', 'That department already exists in the selected faculty.');
    }
    res.redirect('/admin/academics');
  });

  router.post('/admin/academics/departments/:id/delete', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const users = db.prepare('SELECT COUNT(*) c FROM users WHERE department_id = ?').get(id).c;
    const courses = db.prepare('SELECT COUNT(*) c FROM courses WHERE owner_department_id = ?').get(id).c;
    if (users || courses) {
      req.flash('error', 'Cannot delete a department that still has users or owned courses. Move them first.');
      return res.redirect('/admin/academics');
    }
    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    req.flash('success', 'Department deleted.');
    res.redirect('/admin/academics');
  });

  // ---- Courses ----
  router.post('/admin/academics/courses', requireLogin, requireSuperAdmin, (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const title = String(req.body.title || '').trim();
    const owner = parseInt(req.body.owner_department_id, 10) || null;
    const level = String(req.body.level || '').trim();
    if (!code || !title || !owner) {
      req.flash('error', 'Course code, title and owner department are required.');
      return res.redirect('/admin/academics');
    }
    try {
      const r = db.prepare('INSERT INTO courses(code, title, owner_department_id, level) VALUES(?, ?, ?, ?)').run(code, title, owner, level);
      db.prepare('INSERT OR IGNORE INTO course_departments(course_id, department_id) VALUES(?, ?)').run(r.lastInsertRowid, owner);
      req.flash('success', `Course ${code} added.`);
    } catch {
      req.flash('error', 'That course code already exists.');
    }
    res.redirect('/admin/academics');
  });

  router.post('/admin/academics/courses/:id/update', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const code = String(req.body.code || '').trim().toUpperCase();
    const title = String(req.body.title || '').trim();
    const owner = parseInt(req.body.owner_department_id, 10) || null;
    const level = String(req.body.level || '').trim();
    if (!id || !code || !title || !owner) {
      req.flash('error', 'Course code, title and owner department are required.');
      return res.redirect('/admin/academics');
    }
    try {
      db.prepare('UPDATE courses SET code = ?, title = ?, owner_department_id = ?, level = ? WHERE id = ?').run(code, title, owner, level, id);
      db.prepare('UPDATE resources SET course_code = ? WHERE course_id = ?').run(code, id);
      db.prepare('INSERT OR IGNORE INTO course_departments(course_id, department_id) VALUES(?, ?)').run(id, owner);
      req.flash('success', `Course ${code} updated.`);
    } catch {
      req.flash('error', 'That course code already exists.');
    }
    res.redirect('/admin/academics');
  });

  router.post('/admin/academics/courses/:id/delete', requireLogin, requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
    if (!course) {
      req.flash('error', 'Course not found.');
      return res.redirect('/admin/academics');
    }
    db.prepare('UPDATE resources SET course_id = NULL WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    req.flash('success', 'Course deleted. Existing resources were kept but are no longer linked to that course.');
    res.redirect('/admin/academics');
  });

  // ---- Course-Department Access ----
  router.post('/admin/academics/courses/:id/departments', requireLogin, requireSuperAdmin, (req, res) => {
    const courseId = parseInt(req.params.id, 10);
    const raw = Array.isArray(req.body.department_ids)
      ? req.body.department_ids
      : [req.body.department_ids].filter(Boolean);
    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      req.flash('error', 'Course not found.');
      return res.redirect('/admin/academics');
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM course_departments WHERE course_id = ?').run(courseId);
      const ins = db.prepare('INSERT OR IGNORE INTO course_departments(course_id, department_id) VALUES(?, ?)');
      raw.forEach(x => {
        const d = parseInt(x, 10);
        if (d) ins.run(courseId, d);
      });
    });
    tx();
    req.flash('success', 'Course access departments updated.');
    res.redirect('/admin/academics');
  });

  // ==============================
  //  ADMIN ANALYTICS
  // ==============================

  router.get('/admin/analytics', requireLogin, requireSuperAdmin, (req, res) => {
    const stats = {
      totalResources: db.prepare('SELECT COUNT(*) c FROM resources').get().c,
      totalDownloads: db.prepare('SELECT COUNT(*) c FROM downloads').get().c,
      totalStudents: db.prepare("SELECT COUNT(*) c FROM users WHERE account_type = 'student'").get().c,
      totalStaff: db.prepare("SELECT COUNT(*) c FROM users WHERE account_type IN ('lecturer','administrator')").get().c,
      totalCourses: db.prepare('SELECT COUNT(*) c FROM courses').get().c,
      totalCategories: db.prepare('SELECT COUNT(*) c FROM categories').get().c
    };

    const downloadsPerDay = db.prepare(
      "SELECT date(downloaded_at) d, COUNT(*) c FROM downloads GROUP BY date(downloaded_at) ORDER BY d DESC LIMIT 14"
    ).all();

    const topResources = db.prepare(
      `SELECT r.title, COALESCE(u.full_name, '—') owner,
              COALESCE(d.downloads, 0) downloads, COALESCE(d.last_download, '—') last_download
       FROM resources r
       LEFT JOIN (SELECT resource_id, COUNT(*) downloads, MAX(downloaded_at) last_download FROM downloads GROUP BY resource_id) d ON d.resource_id = r.id
       LEFT JOIN users u ON u.id = r.uploaded_by
       ORDER BY COALESCE(d.downloads, 0) DESC, r.title COLLATE NOCASE
       LIMIT 10`
    ).all();

    const departmentTotals = db.prepare(
      `SELECT COALESCE(rd.name, 'Unassigned') name, COUNT(*) students
       FROM users u LEFT JOIN departments rd ON rd.id = u.department_id
       WHERE u.account_type = 'student'
       GROUP BY rd.name ORDER BY students DESC`
    ).all();

    const categoryTotals = db.prepare(
      `SELECT COALESCE(c.name, 'Uncategorised') name, COUNT(*) resources
       FROM resources r LEFT JOIN categories c ON c.id = r.category_id
       GROUP BY c.name ORDER BY resources DESC`
    ).all();

    const uploaders = db.prepare(
      `SELECT COALESCE(u.full_name, 'Admin / Deleted') name, COUNT(*) resources
       FROM resources r LEFT JOIN users u ON u.id = r.uploaded_by
       GROUP BY u.full_name ORDER BY resources DESC LIMIT 8`
    ).all();

    res.render('admin_analytics', { stats, downloadsPerDay, topResources, departmentTotals, categoryTotals, uploaders });
  });

  return router;
};
