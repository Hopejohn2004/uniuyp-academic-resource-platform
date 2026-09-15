# Deployment notes

## Local / school demonstration
Use SQLite and the local `uploads/` directory. Run `npm install`, `npm test`, then `npm start`.

## SQLite operational notes
The database runs in **WAL mode** with a 5-second busy timeout, which allows concurrent
reads during writes and smooths out brief lock contention on a shared filesystem.

- The database file is `db/platform.db`. With WAL mode, SQLite also writes
  `db/platform.db-wal` and `db/platform.db-shm` beside it — back these up together
  (or take a consistent snapshot using SQLite's `.backup` command).
- Structure is created/migrated automatically by `db.js` on startup, so deploying a new
  version only requires shipping the application code; the schema upgrades in place.
- For a real deployment, take a daily backup of `db/platform.db` (and the `wal`/`shm`
  files or a `.backup` snapshot) plus the `uploads/` directory to cloud storage.

## Render
The repository includes a `render.yaml` blueprint. With the Render CLI or the "New →
Blueprint" flow pointed at this repo it provisions a Node web service plus the required
environment variables.

> Free-tier services cannot mount persistent disks, so the deployed filesystem is
> **ephemeral**: the SQLite database and `uploads/` are recreated on every deploy or
> restart. That is acceptable for the demonstration. For persistent storage, upgrade
> the service to a paid plan and add a disk, or use object storage plus a managed
> database (see below).

Set these secrets in the Render dashboard (marked `sync: false` in the blueprint):
`BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`.

`DATA_DIR` is set to `/opt/render/project/src` (the ephemeral project directory):
the SQLite database lives at `$DATA_DIR/db/platform.db` and uploaded files at
`$DATA_DIR/uploads`. Because the DB is empty on each fresh deploy, the initial
administrator account is recreated from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME`
on first boot — run `npm run seed` after deploying if you want the demo data back.

**Important:** a normal ephemeral web-service filesystem is not suitable for permanent academic files or a production SQLite database. For production, move resource files to persistent object storage (such as Amazon S3) and move the database to a managed relational database. Keep SQLite for the final-year demonstration unless a production deployment is required.

## Environment variables
See `.env.example`. Never commit `.env`, API keys, passwords, `db/platform.db`, or uploaded files.
