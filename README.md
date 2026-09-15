# UNIUYO Academic Resource Platform

A Node.js/Express/EJS academic resource management platform for students, lecturers and administrators.

## Roles
- **Student:** browse and download academic resources.
- **Lecturer:** upload and manage resources.
- **Administrator:** manage users and perform lecturer functions.

## Local setup
1. Install Node.js 18+ (Node 20+ recommended).
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, and `SESSION_SECRET`.
4. Run `npm test`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Uploads
Maximum resource size is **100 MB**. Allowed formats: PDF, Word, PowerPoint, Excel, TXT, CSV, JPG, JPEG and PNG.

## Password reset
Password reset uses Resend when `RESEND_API_KEY` is configured. During local development without an email provider, the reset link is printed to the server terminal.

## Project structure

```
server.js              Entry point: middleware wiring, route mounting, error handler
db.js                  SQLite schema, migrations and seed data
session-store.js       SQLite-backed session store for express-session
routes/auth.js         Register, login, email verification, password reset
routes/resources.js    Upload, edit, delete, download, my uploads/downloads
routes/courses.js      Course catalog and course detail
routes/dashboard.js    Resource dashboard with search/filter/pagination
routes/admin.js        User management, academic structure, analytics
middleware/auth.js     Login / lecturer / super-admin guards
middleware/csrf.js     CSRF token generation and verification
middleware/rateLimit.js Per-IP request rate limiting
services/email.js      Resend email delivery + HTML templates
services/helpers.js    Shared utilities (URLs, email/password validation)
views/                 EJS templates
tests/                 Node test runner suite (npm test)
diagrams/              Architecture, ERD, class, use-case and sequence diagrams
```

## Production note
For a real deployment, use persistent cloud storage (e.g. S3) for uploaded files and a managed database rather than relying on the local SQLite/upload folders. See `DEPLOYMENT.md`.

## Academic structure and access model

The platform uses a normalized academic catalogue designed for a university deployment:

- **Faculty → Department → User** hierarchy.
- Students have a **registration number** and department.
- Lecturers/administrators have a **staff ID** and department.
- Administrator user search supports registration number, staff ID, name and email, with pagination and faculty/department/type filters.
- **Primary Administrator** remains protected; delegated administrators are displayed as **Administrator-Lecturer**.
- Courses have an **owner department** but can be offered to multiple departments through `course_departments`.
- Resources belong to a course, rather than being duplicated for every department that takes the course.
- Student dashboard access is based on the student's department being listed for that course.
- Course search matches both course code and course title, so a Mathematics student can search for `CSC 201` and retrieve an eligible Computer Science resource.
- Resource uploads include course, level, semester and academic session metadata.

### Example

`CSC 201 — Introduction to Computer Science`

Owner: Computer Science

Offered to: Computer Science, Mathematics, Statistics

A lecturer uploads one CSC 201 lecture note. The same stored resource is available to eligible students in all three departments; no duplicate upload is required.

### Admin workflow

1. Open **Academic Structure**.
2. Add faculties and departments.
3. Add courses and select the owner department.
4. Open a course's **Set departments that can take/access this course** section.
5. Select every department that should have access and save.
6. Open **Manage Users** to create/search/edit users and assign their departments.
