require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

const UPLOADS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const NAME = 'Demo';
const DEMO_LECTURER_EMAIL = 'demo.lecturer@uniuyo.edu.ng';
const DEMO_STUDENT_EMAIL = 'demo.student@uniuyo.edu.ng';
const DEMO_ADMIN_EMAIL = 'demo.admin@uniuyo.edu.ng';
const PASSWORD = 'demo1234';

function seedFile(content) {
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), content);
  return fileName;
}

function ensureFaculty(name) {
  let row = db.prepare('SELECT id FROM faculties WHERE name = ?').get(name);
  if (!row) row = { id: db.prepare('INSERT INTO faculties (name) VALUES (?)').run(name).lastInsertRowid };
  return row.id;
}

function ensureDepartment(name, facultyId) {
  let row = db.prepare('SELECT id FROM departments WHERE name = ? AND faculty_id = ?').get(name, facultyId);
  if (!row) row = { id: db.prepare('INSERT INTO departments (name, faculty_id) VALUES (?, ?)').run(name, facultyId).lastInsertRowid };
  return row.id;
}

function ensureCourse(code, title, level, ownerDeptId) {
  let course = db.prepare('SELECT id FROM courses WHERE code = ?').get(code);
  if (!course) {
    course = { id: db.prepare(
      'INSERT INTO courses (code, title, level, owner_department_id) VALUES (?, ?, ?, ?)'
    ).run(code, title, level, ownerDeptId).lastInsertRowid };
    db.prepare('INSERT OR IGNORE INTO course_departments (course_id, department_id) VALUES (?, ?)')
      .run(course.id, ownerDeptId);
  }
  return course.id;
}

// ---------- Run only if the demo data is not already seeded ----------
const alreadySeeded = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_LECTURER_EMAIL);
if (alreadySeeded) {
  console.log('Demo data already present. Nothing to do (delete the demo users to re-seed).');
  process.exit(0);
}

const csFaculty = ensureFaculty('Faculty of Computing');
const csDept = ensureDepartment('Computer Science', csFaculty);
const mathsDept = ensureDepartment('Mathematics', csFaculty);
const statsDept = ensureDepartment('Statistics', csFaculty);

const cs101 = ensureCourse('CSC 101', 'Introduction to Computing', '100 Level', csDept);
const cs201 = ensureCourse('CSC 201', 'Data Structures and Algorithms', '200 Level', csDept);
const mth101 = ensureCourse('MTH 101', 'Calculus I', '100 Level', mathsDept);
const sta101 = ensureCourse('STA 101', 'Statistics I', '100 Level', statsDept);
db.prepare('INSERT OR IGNORE INTO course_departments (course_id, department_id) VALUES (?, ?)').run(mth101, csDept);
db.prepare('INSERT OR IGNORE INTO course_departments (course_id, department_id) VALUES (?, ?)').run(sta101, csDept);

const passwordHash = bcrypt.hashSync(PASSWORD, 12);
const insertUser = db.prepare(
  `INSERT INTO users(full_name, matric_or_staff_no, registration_number, staff_id, email, password, department, department_id, faculty_id, role, account_type, can_manage_users, is_primary_admin, email_verified)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`
);

const lecturerId = insertUser.run(
  `${NAME} Lecturer`, 'UNIUYO/SC/CO/0001', null, 'UNIUYO/SC/CO/0001',
  DEMO_LECTURER_EMAIL, passwordHash, 'Computer Science', csDept, csFaculty,
  'admin', 'lecturer', 0
).lastInsertRowid;

insertUser.run(
  `${NAME} Student`, '21/SC/CO/0001', '21/SC/CO/0001', null,
  DEMO_STUDENT_EMAIL, passwordHash, 'Computer Science', csDept, csFaculty,
  'student', 'student', 0
);

insertUser.run(
  `${NAME} Administrator`, 'UNIUYO/SC/CO/0002', null, 'UNIUYO/SC/CO/0002',
  DEMO_ADMIN_EMAIL, passwordHash, 'Computer Science', csDept, csFaculty,
  'admin', 'administrator', 1
);

const lectureNotes = db.prepare("SELECT id FROM categories WHERE name = 'Lecture Notes'").get().id;
const pastQuestions = db.prepare("SELECT id FROM categories WHERE name = 'Past Questions'").get().id;

const insertResource = db.prepare(
  `INSERT INTO resources (title, description, course_code, course_id, category_id, level, semester, academic_session, file_name, original_name, file_size, uploaded_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function addResource(title, description, courseCode, courseId, category, level, semester, session, content, byId) {
  const originalName = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
  const fileName = seedFile(content);
  insertResource.run(
    title, description, courseCode, courseId, category, level, semester, session,
    fileName, originalName, Buffer.byteLength(content), byId
  );
}

addResource('CSC 101 - Week 1 Lecture Note', 'Introduction to computing concepts.', 'CSC 101', cs101, lectureNotes, '100 Level', 'First Semester', '2026/2027', 'Hardware, software, and the history of computing.\n', lecturerId);
addResource('CSC 201 - Arrays and Linked Lists', 'Detailed notes on linear data structures.', 'CSC 201', cs201, lectureNotes, '200 Level', 'First Semester', '2026/2027', 'Arrays: static vs dynamic. Linked lists with diagrams.\n', lecturerId);
addResource('MTH 101 - Limits Past Questions', 'Practice questions on limits and continuity.', 'MTH 101', mth101, pastQuestions, '100 Level', 'First Semester', '2026/2027', 'Compute: lim(x->0) sin(x)/x.\n', lecturerId);
addResource('STA 101 - Descriptive Statistics', 'Measures of central tendency and spread.', 'STA 101', sta101, lectureNotes, '100 Level', 'First Semester', '2026/2027', 'Mean, median, mode, variance.\n', lecturerId);

console.log('Demo data seeded successfully.');
console.log('');
console.log(`Lecturer login:  ${DEMO_LECTURER_EMAIL}  / ${PASSWORD}`);
console.log(`Student login:   ${DEMO_STUDENT_EMAIL}  / ${PASSWORD}`);
console.log(`Admin login:     ${DEMO_ADMIN_EMAIL}  / ${PASSWORD}`);