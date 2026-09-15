# Academic Data Model

## Core relationships

- `faculties (1) -> departments (many)`
- `departments (1) -> users (many)`
- `departments (1) -> courses (many)` as the course owner
- `courses (many) <-> departments (many)` through `course_departments`
- `courses (1) -> resources (many)`
- `users (1) -> resources (many)` as uploader

## Why courses are many-to-many with departments

University courses are not always restricted to the department that owns them. For example, Computer Science can own `CSC 201`, while Mathematics and Statistics also take the course. The resource is therefore stored once against `CSC 201`; the `course_departments` table determines which departments can access it.

This avoids duplicated files and keeps updates consistent.
