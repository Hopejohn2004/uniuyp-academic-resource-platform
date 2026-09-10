require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const SqliteSessionStore = require('./session-store');

// --- Services ---
const emailService = require('./services/email');
const { absoluteUrl, normalizeEmail, validPassword, accountLabel } = require('./services/helpers');

// --- Middleware ---
const rateLimit = require('./middleware/rateLimit');
const { ensureCsrf, verifyCsrf } = require('./middleware/csrf');
const { requireLogin, requireLecturer, requireSuperAdmin } = require('./middleware/auth');
const requireSuperAdminMw = requireSuperAdmin(db);

// --- Routes ---
const createAuthRoutes = require('./routes/auth');
const createResourceRoutes = require('./routes/resources');
const createCourseRoutes = require('./routes/courses');
const createDashboardRoutes = require('./routes/dashboard');
const createAdminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1); // Render terminates TLS at its proxy; needed for secure cookies
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}

// ==============================
//  VIEW ENGINE
// ==============================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// ==============================
//  GLOBAL MIDDLEWARE
// ==============================

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'"
  );
  next();
});

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
app.use(session({
  store: new SqliteSessionStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION
  }
}));

app.use(flash());

// CSRF protection
app.use(ensureCsrf);

// Inject user and flash messages into views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// ==============================
//  SHARED HELPERS FOR ROUTES
// ==============================

function getDepartments() {
  return db.prepare(
    `SELECT d.id, d.name, d.faculty_id, f.name AS faculty_name
     FROM departments d JOIN faculties f ON f.id = d.faculty_id
     ORDER BY f.name, d.name`
  ).all();
}

// ==============================
//  ROUTES
// ==============================

// Auth routes (register, login, logout, password reset, etc.)
app.use(createAuthRoutes({
  db, rateLimit, absoluteUrl, normalizeEmail, validPassword, emailService, getDepartments, baseUrl: BASE_URL
}));

// Dashboard & root redirect
app.use(createDashboardRoutes({ db, requireLogin }));

// Resource management (upload, edit, delete, download, my pages)
app.use(createResourceRoutes({ db, rateLimit, requireLogin, requireLecturer, verifyCsrf }));

// Course catalog
app.use(createCourseRoutes({ db, requireLogin }));

// Admin routes (user management, academic structure, analytics)
app.use(createAdminRoutes({
  db, rateLimit, requireLogin, requireSuperAdmin: requireSuperAdminMw, normalizeEmail, validPassword, accountLabel
}));

// ==============================
//  ERROR HANDLER
// ==============================

app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    time: new Date().toISOString(),
    level: 'error',
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    message: err && err.message,
    ...(IS_PRODUCTION ? {} : { stack: err && err.stack })
  }));
  if (req.file && req.file.path) fs.rm(req.file.path, { force: true }, () => {});
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    req.flash('error', 'File is too large. Maximum allowed size is 100 MB.');
    return res.redirect('/upload');
  }
  if (err && err.message && err.message.startsWith('Unsupported file type')) {
    req.flash('error', err.message);
    return res.redirect('/upload');
  }
  res.status(500).send('Something went wrong on the server.');
});

// ==============================
//  START
// ==============================

if (require.main === module) {
  app.listen(PORT, () => console.log(`Academic Resource Platform running at http://localhost:${PORT}`));
}

module.exports = app;
