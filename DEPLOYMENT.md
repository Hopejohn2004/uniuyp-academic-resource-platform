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
Blueprint" flow pointed at this repo, it provisions a Node web service with a 1 GB
disk mounted at `/data`, plus the required environment variables.

Set these secrets in the Render dashboard (marked `sync: false` in the blueprint):
`BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`.

`DATA_DIR` points to the mounted disk. The SQLite database lives at `$DATA_DIR/db/platform.db`
and uploaded files at `$DATA_DIR/uploads` — both persist on the disk across deploys and restarts.
Without a disk, use `/opt/render/project/src` as `DATA_DIR` for ephemeral storage (files are
lost on redeploy), which is fine only for quick smoke tests.

**Important:** a normal ephemeral web-service filesystem is not suitable for permanent academic files or a production SQLite database. For production, move resource files to persistent object storage (such as Amazon S3) and move the database to a managed relational database. Keep SQLite for the final-year demonstration unless a production deployment is required.

## Environment variables
See `.env.example`. Never commit `.env`, API keys, passwords, `db/platform.db`, or uploaded files.
