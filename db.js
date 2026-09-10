const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const dbDir = path.join(DATA_DIR, 'db');
require('fs').mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'platform.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  matric_or_staff_no TEXT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  department TEXT,
  role TEXT NOT NULL CHECK(role IN ('student','admin')) DEFAULT 'student',
  can_manage_users INTEGER NOT NULL DEFAULT 0,
  is_primary_admin INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  account_type TEXT NOT NULL DEFAULT 'student',
  registration_number TEXT,
  staff_id TEXT,
  faculty_id INTEGER,
  department_id INTEGER,
  level TEXT,
  reset_token TEXT,
  reset_expires TEXT,
  verification_token TEXT,
  verification_expires TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS faculties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  faculty_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, faculty_id),
  FOREIGN KEY(faculty_id) REFERENCES faculties(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  owner_department_id INTEGER,
  level TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_department_id) REFERENCES departments(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS course_departments (
  course_id INTEGER NOT NULL,
  department_id INTEGER NOT NULL,
  PRIMARY KEY(course_id, department_id),
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  course_code TEXT,
  course_id INTEGER,
  category_id INTEGER,
  level TEXT,
  semester TEXT,
  academic_session TEXT,
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL,
  FOREIGN KEY(category_id) REFERENCES categories(id),
  FOREIGN KEY(uploaded_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  downloaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(resource_id) REFERENCES resources(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

function addColumn(table, column, definition) {
  try { db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get(); }
  catch { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
}
addColumn('users', 'account_type', "TEXT NOT NULL DEFAULT 'student'");
addColumn('users', 'reset_token', 'TEXT');
addColumn('users', 'reset_expires', 'TEXT');
addColumn('users', 'is_primary_admin', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'registration_number', 'TEXT');
addColumn('users', 'staff_id', 'TEXT');
addColumn('users', 'faculty_id', 'INTEGER');
addColumn('users', 'department_id', 'INTEGER');
addColumn('users', 'level', 'TEXT');
addColumn('resources', 'course_id', 'INTEGER');
addColumn('resources', 'level', 'TEXT');
addColumn('resources', 'semester', 'TEXT');
addColumn('resources', 'academic_session', 'TEXT');

// Preserve old projects while moving them toward the normalized academic structure.
db.exec(`
UPDATE users SET account_type = CASE
  WHEN role = 'admin' AND can_manage_users = 1 THEN 'administrator'
  WHEN role = 'admin' THEN 'lecturer'
  ELSE 'student' END
WHERE (account_type IS NULL OR account_type = 'student') AND role = 'admin';
UPDATE users SET registration_number = matric_or_staff_no
WHERE account_type = 'student' AND (registration_number IS NULL OR registration_number = '') AND matric_or_staff_no IS NOT NULL;
UPDATE users SET staff_id = matric_or_staff_no
WHERE account_type IN ('lecturer','administrator') AND (staff_id IS NULL OR staff_id = '') AND matric_or_staff_no IS NOT NULL;
`);

const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
  ['Lecture Notes', 'Past Questions', 'Project Reports', 'Assignments', 'E-Books'].forEach(c => insertCat.run(c));
}

// Seed a useful starter faculty/department only when the academic catalogue is empty.
if (db.prepare('SELECT COUNT(*) AS c FROM faculties').get().c === 0) {
  const faculty = db.prepare('INSERT INTO faculties (name) VALUES (?)').run('Faculty of Computing');
  db.prepare('INSERT INTO departments (name, faculty_id) VALUES (?, ?)').run('Computer Science', faculty.lastInsertRowid);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@uniuyo.edu.ng';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Administrator';
const adminExists = db.prepare("SELECT * FROM users WHERE account_type = 'administrator' OR (role = 'admin' AND can_manage_users = 1) LIMIT 1").get();
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  const dept = db.prepare("SELECT id FROM departments WHERE name = 'Computer Science' ORDER BY id LIMIT 1").get();
  db.prepare(`INSERT INTO users (full_name, matric_or_staff_no, staff_id, email, password, department, department_id, role, can_manage_users, is_primary_admin, email_verified, account_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', 1, 1, 1, 'administrator')`)
    .run(ADMIN_NAME, 'STAFF/001', 'STAFF/001', ADMIN_EMAIL, hash, 'Computer Science', dept ? dept.id : null);
}
const primaryExists = db.prepare("SELECT id FROM users WHERE is_primary_admin = 1 LIMIT 1").get();
if (!primaryExists) {
  const candidate = db.prepare(`SELECT id FROM users WHERE account_type = 'administrator' OR (role = 'admin' AND can_manage_users = 1)
    ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END, id ASC LIMIT 1`).get(ADMIN_EMAIL);
  if (candidate) db.prepare("UPDATE users SET is_primary_admin=1, account_type='administrator', role='admin', can_manage_users=1 WHERE id=?").run(candidate.id);
}
db.prepare("UPDATE users SET can_manage_users=1 WHERE account_type='administrator'").run();

// Link legacy department text to the normalized department table where possible.
db.exec(`
UPDATE users SET department_id = (
  SELECT d.id FROM departments d WHERE lower(d.name) = lower(users.department) LIMIT 1
) WHERE department_id IS NULL AND department IS NOT NULL AND trim(department) <> '';
UPDATE users SET faculty_id = (
  SELECT d.faculty_id FROM departments d WHERE d.id = users.department_id
) WHERE faculty_id IS NULL AND department_id IS NOT NULL;
UPDATE resources SET course_id = (
  SELECT c.id FROM courses c WHERE lower(c.code) = lower(resources.course_code) LIMIT 1
) WHERE course_id IS NULL AND course_code IS NOT NULL AND trim(course_code) <> '';
`);

// Helpful indexes for 1,000–2,000+ user deployments and course searching.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_users_registration_number ON users(registration_number);
CREATE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(full_name);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_faculty ON users(faculty_id);
CREATE INDEX IF NOT EXISTS idx_departments_faculty ON departments(faculty_id);
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code);
CREATE INDEX IF NOT EXISTS idx_courses_owner_department ON courses(owner_department_id);
CREATE INDEX IF NOT EXISTS idx_course_departments_department ON course_departments(department_id);
CREATE INDEX IF NOT EXISTS idx_resources_course ON resources(course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

module.exports = db;
