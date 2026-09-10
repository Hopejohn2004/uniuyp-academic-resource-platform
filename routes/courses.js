const express = require('express');

module.exports = function createCourseRoutes(config) {
  const { db, requireLogin } = config;
  const router = express.Router();

  // ---- Course Listing ----
  router.get('/courses', requireLogin, (req, res) => {
    const me = db.prepare('SELECT department_id, account_type FROM users WHERE id = ?').get(req.session.user.id);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 24;
    const isStudentEligibleFiltered = me && me.account_type === 'student' && me.department_id;

    let where = '';
    const params = [];
    if (isStudentEligibleFiltered) {
      where = ' WHERE c.id IN (SELECT cd.course_id FROM course_departments cd WHERE cd.department_id = ?)';
      params.push(me.department_id);
    }

    const total = db.prepare(`SELECT COUNT(*) c FROM courses c${where}`).get(...params).c;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const courses = db.prepare(
      `SELECT c.*, d.name owner_department,
              (SELECT COUNT(*) FROM resources r WHERE r.course_id = c.id) resource_count,
              (SELECT COUNT(*) FROM course_departments cd WHERE cd.course_id = c.id) offered_count
       FROM courses c
       LEFT JOIN departments d ON d.id = c.owner_department_id
       ${where}
       ORDER BY c.code
       LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    res.render('courses', { courses, total, totalPages, page: safePage });
  });

  // ---- Course Detail ----
  router.get('/courses/:id', requireLogin, (req, res) => {
    const course = db.prepare(
      `SELECT c.*, d.name owner_department,
              (SELECT group_concat(d2.name, ', ')
               FROM course_departments cd2
               JOIN departments d2 ON d2.id = cd2.department_id
               WHERE cd2.course_id = c.id) offered_departments
       FROM courses c
       LEFT JOIN departments d ON d.id = c.owner_department_id
       WHERE c.id = ?`
    ).get(req.params.id);

    if (!course) {
      req.flash('error', 'Course not found.');
      return res.redirect('/courses');
    }

    const me = db.prepare('SELECT department_id, account_type FROM users WHERE id = ?').get(req.session.user.id);
    const eligibleStudent = me && me.account_type === 'student' && me.department_id &&
      !!db.prepare('SELECT 1 FROM course_departments WHERE course_id = ? AND department_id = ?').get(course.id, me.department_id);

    let resources = [];
    if (me.account_type !== 'student' || eligibleStudent) {
      resources = db.prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM downloads d WHERE d.resource_id = r.id) download_count,
                c.name category_name, users.full_name uploader
         FROM resources r
         LEFT JOIN categories c ON c.id = r.category_id
         LEFT JOIN users ON users.id = r.uploaded_by
         WHERE r.course_id = ?
         ORDER BY r.created_at DESC`
      ).all(course.id);
    }

    res.render('course_detail', {
      course,
      resources,
      accessible: me.account_type !== 'student' || eligibleStudent
    });
  });

  return router;
};
