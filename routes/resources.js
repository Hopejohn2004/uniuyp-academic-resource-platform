const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const allowedTypes = new Set([
  '.pdf:application/pdf',
  '.doc:application/msword',
  '.docx:application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt:application/vnd.ms-powerpoint',
  '.pptx:application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls:application/vnd.ms-excel',
  '.xlsx:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt:text/plain',
  '.csv:text/csv',
  '.jpg:image/jpeg',
  '.jpeg:image/jpeg',
  '.png:image/png'
]);

const UPLOADS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = function createResourceRoutes(config) {
  const { db, rateLimit, requireLogin, requireLecturer, verifyCsrf } = config;
  const router = express.Router();

  function canManageResource(sessionUser, resource) {
    return sessionUser.accountType === 'administrator' || resource.uploaded_by === sessionUser.id;
  }

  function getCoursesForDropDown() {
    return db.prepare(
      `SELECT c.*, d.name owner_department FROM courses c LEFT JOIN departments d ON d.id = c.owner_department_id ORDER BY c.code`
    ).all();
  }

  // A student may only see/download a resource if it has no course linkage (generic
  // material) or the student's department is eligible for that resource's course.
  function studentCanAccessResource(resource, user) {
    if (user.accountType !== 'student') return true;
    if (!resource.course_id) return true;
    if (!user.departmentId) return false;
    return !!db.prepare(
      'SELECT 1 FROM course_departments WHERE course_id = ? AND department_id = ?'
    ).get(resource.course_id, user.departmentId);
  }

  // ---- Multer setup ----
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedTypes.has(`${ext}:${file.mimetype}`)) return cb(null, true);
      return cb(new Error('Unsupported file type. Upload PDF, Word, PowerPoint, Excel, TXT, CSV, JPG, JPEG or PNG files only.'));
    }
  });

  // ---- Upload ----
  router.get('/upload', requireLogin, requireLecturer, (req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    const courses = db.prepare(
      `SELECT c.*, d.name owner_department FROM courses c LEFT JOIN departments d ON d.id = c.owner_department_id ORDER BY c.code`
    ).all();
    res.render('upload', { categories, courses });
  });

  router.post('/upload', requireLogin, requireLecturer, rateLimit({ max: 20 }), upload.single('file'), verifyCsrf, (req, res) => {
    const { title, description, category_id, course_id, level, semester, academic_session } = req.body;
    if (!req.file) {
      req.flash('error', 'Please choose a file to upload.');
      return res.redirect('/upload');
    }
    if (!title || title.trim().length < 2) {
      fs.rmSync(req.file.path, { force: true });
      req.flash('error', 'Please provide a valid resource title.');
      return res.redirect('/upload');
    }
    const course = course_id
      ? db.prepare('SELECT id, code FROM courses WHERE id = ?').get(Number(course_id))
      : null;

    db.prepare(
      `INSERT INTO resources(title, description, course_code, course_id, category_id, level, semester, academic_session, file_name, original_name, file_size, uploaded_by)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      title.trim(),
      String(description || '').trim(),
      course ? course.code : '',
      course ? course.id : null,
      category_id || null,
      String(level || '').trim(),
      String(semester || '').trim(),
      String(academic_session || '').trim(),
      req.file.filename,
      req.file.originalname,
      req.file.size,
      req.session.user.id
    );
    req.flash('success', `"${title.trim()}" was uploaded successfully.`);
    res.redirect('/dashboard');
  });

  // ---- Delete ----
  router.post('/resources/:id/delete', requireLogin, requireLecturer, (req, res) => {
    const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
    if (!resource) {
      req.flash('error', 'Resource not found.');
      return res.redirect('/dashboard');
    }
    if (!canManageResource(req.session.user, resource)) {
      req.flash('error', 'You can only delete resources you uploaded.');
      return res.redirect('/dashboard');
    }
    // Delete DB records first, then the file (atomic-ish: DB is source of truth)
    db.prepare('DELETE FROM downloads WHERE resource_id = ?').run(resource.id);
    db.prepare('DELETE FROM resources WHERE id = ?').run(resource.id);
    fs.rmSync(path.join(UPLOADS_DIR, resource.file_name), { force: true });
    req.flash('success', 'Resource deleted.');
    res.redirect('/dashboard');
  });

  // ---- Edit (GET) ----
  router.get('/resources/:id/edit', requireLogin, requireLecturer, (req, res) => {
    const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
    if (!resource) {
      req.flash('error', 'Resource not found.');
      return res.redirect('/dashboard');
    }
    if (!canManageResource(req.session.user, resource)) {
      req.flash('error', 'You can only edit resources you uploaded.');
      return res.redirect('/dashboard');
    }
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    res.render('edit', { resource, categories, courses: getCoursesForDropDown() });
  });

  // ---- Edit (POST) ----
  router.post('/resources/:id/edit', requireLogin, requireLecturer, rateLimit({ max: 20 }), upload.single('file'), verifyCsrf, (req, res) => {
    const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
    if (!resource) {
      req.flash('error', 'Resource not found.');
      return res.redirect('/dashboard');
    }
    if (!canManageResource(req.session.user, resource)) {
      req.flash('error', 'You can only edit resources you uploaded.');
      return res.redirect('/dashboard');
    }
    const title = String(req.body.title || '').trim();
    const courseId = req.body.course_id ? Number(req.body.course_id) : null;
    const course = courseId && db.prepare('SELECT id, code FROM courses WHERE id = ?').get(courseId);
    if (!title || title.length < 2) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      req.flash('error', 'Please provide a valid resource title.');
      return res.redirect(`/resources/${resource.id}/edit`);
    }

    let newFileName = resource.file_name;
    let newOriginalName = resource.original_name;
    let newFileSize = resource.file_size;

    if (req.file) {
      if (resource.file_name) fs.rmSync(path.join(UPLOADS_DIR, resource.file_name), { force: true });
      newFileName = req.file.filename;
      newOriginalName = req.file.originalname;
      newFileSize = req.file.size;
    }

    db.prepare(
      `UPDATE resources SET title = ?, description = ?, course_id = ?, course_code = ?, category_id = ?, level = ?, semester = ?, academic_session = ?, file_name = ?, original_name = ?, file_size = ? WHERE id = ?`
    ).run(
      title,
      String(req.body.description || '').trim(),
      course ? course.id : null,
      course ? course.code : '',
      req.body.category_id ? Number(req.body.category_id) : null,
      String(req.body.level || '').trim(),
      String(req.body.semester || '').trim(),
      String(req.body.academic_session || '').trim(),
      newFileName,
      newOriginalName,
      newFileSize,
      resource.id
    );
    req.flash('success', `"${title}" was updated successfully.`);
    res.redirect('/dashboard');
  });

  // ---- Download ----
  router.get('/resources/:id/download', requireLogin, (req, res) => {
    const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
    if (!resource) {
      req.flash('error', 'Resource not found.');
      return res.redirect('/dashboard');
    }
    const user = db.prepare('SELECT id, account_type, department_id FROM users WHERE id = ?').get(req.session.user.id);
    const accessUser = { accountType: user.account_type, departmentId: user.department_id };
    if (!studentCanAccessResource(resource, accessUser)) {
      req.flash('error', 'This resource is only available to students in eligible departments.');
      return res.redirect('/dashboard');
    }
    const filePath = path.join(UPLOADS_DIR, resource.file_name);
    if (!fs.existsSync(filePath)) {
      req.flash('error', 'The resource file is missing from storage.');
      return res.redirect('/dashboard');
    }
    db.prepare('INSERT INTO downloads (resource_id, user_id) VALUES (?, ?)').run(resource.id, req.session.user.id);
    res.download(filePath, resource.original_name);
  });

  // ---- My Uploads ----
  router.get('/my-uploads', requireLogin, requireLecturer, (req, res) => {
    const resources = db.prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM downloads d WHERE d.resource_id = r.id) download_count,
              c.name category_name, courses.code course_catalog_code, courses.title course_title
       FROM resources r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN courses ON courses.id = r.course_id
       WHERE r.uploaded_by = ?
       ORDER BY r.created_at DESC`
    ).all(req.session.user.id);
    res.render('my_uploads', { resources });
  });

  // ---- My Downloads ----
  router.get('/my-downloads', requireLogin, (req, res) => {
    const downloads = db.prepare(
      `SELECT d.downloaded_at, r.id resource_id, r.title, r.original_name, r.file_size,
              c.name category_name, r.course_code, courses.code course_catalog_code, courses.title course_title
       FROM downloads d
       JOIN resources r ON r.id = d.resource_id
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN courses ON courses.id = r.course_id
       WHERE d.user_id = ?
       ORDER BY d.downloaded_at DESC`
    ).all(req.session.user.id);
    res.render('my_downloads', { downloads });
  });

  return router;
};
