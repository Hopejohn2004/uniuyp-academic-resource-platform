const express = require('express');

module.exports = function createDashboardRoutes(config) {
  const { db, requireLogin } = config;
  const router = express.Router();

  router.get('/dashboard', requireLogin, (req, res) => {
    const q = String(req.query.q || '').trim();
    const categoryId = String(req.query.category || '');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 10;

    const me = db.prepare('SELECT id, department_id, account_type FROM users WHERE id = ?').get(req.session.user.id);

    let where = ' WHERE 1=1';
    const params = [];

    // Students only see resources from courses their department is eligible for
    if (me && me.account_type === 'student' && me.department_id) {
      where += ` AND (resources.course_id IS NULL OR EXISTS(
        SELECT 1 FROM course_departments cd
        WHERE cd.course_id = resources.course_id AND cd.department_id = ?
      ))`;
      params.push(me.department_id);
    }

    // Search filter
    if (q) {
      where += ` AND (resources.title LIKE ? OR resources.course_code LIKE ? OR resources.description LIKE ?
        OR resources.original_name LIKE ?
        OR EXISTS(SELECT 1 FROM courses c WHERE c.id = resources.course_id AND (c.code LIKE ? OR c.title LIKE ?)))`;
      const x = `%${q}%`;
      params.push(x, x, x, x, x, x);
    }

    // Category filter
    if (categoryId && /^\d+$/.test(categoryId)) {
      where += ' AND resources.category_id = ?';
      params.push(Number(categoryId));
    }

    const total = db.prepare(`SELECT COUNT(*) c FROM resources${where}`).get(...params).c;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const resources = db.prepare(
      `SELECT resources.*,
              (SELECT COUNT(*) FROM downloads d WHERE d.resource_id = resources.id) download_count,
              categories.name category_name,
              users.full_name uploader,
              courses.code course_catalog_code,
              courses.title course_title
       FROM resources
       LEFT JOIN categories ON resources.category_id = categories.id
       LEFT JOIN users ON resources.uploaded_by = users.id
       LEFT JOIN courses ON resources.course_id = courses.id
       ${where}
       ORDER BY resources.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

    const stats = {
      totalResources: db.prepare('SELECT COUNT(*) c FROM resources').get().c,
      totalStudents: db.prepare("SELECT COUNT(*) c FROM users WHERE account_type = 'student'").get().c,
      totalLecturers: db.prepare("SELECT COUNT(*) c FROM users WHERE account_type IN ('lecturer','administrator')").get().c,
      totalDownloads: db.prepare('SELECT COUNT(*) c FROM downloads').get().c
    };

    res.render('dashboard', {
      resources, categories, stats, q, categoryId,
      page: safePage, totalPages, total
    });
  });

  // Root redirect
  router.get('/', (req, res) => {
    res.redirect(req.session.user ? '/dashboard' : '/login');
  });

  return router;
};
