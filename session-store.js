const { Store } = require('express-session');
const db = require('./db');

// SQLite-backed session store for express-session so sessions survive server
// restarts instead of living only in memory. Uses the same better-sqlite3
// database already in the project (no extra dependency).
class SqliteSessionStore extends Store {
  constructor(options = {}) {
    super(options);
    this.cleanupIntervalMs = options.cleanupIntervalMs || 15 * 60 * 1000;
    if (!options.disableCleanup) {
      const timer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
      timer.unref();
    }
  }

  _expiredAt(session) {
    const cookie = session && session.cookie;
    if (cookie && cookie.expires) return new Date(cookie.expires).getTime();
    return Date.now() + (cookie && cookie.maxAge ? cookie.maxAge : 60 * 60 * 1000);
  }

  get(sid, cb) {
    const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
    if (!row) return cb(null, null);
    if (row.expires && row.expires < Date.now()) {
      this.destroy(sid, () => cb(null, null));
      return;
    }
    let session;
    try {
      session = JSON.parse(row.sess);
      if (session && session.cookie && typeof session.cookie.expires === 'string') {
        session.cookie.expires = new Date(session.cookie.expires);
      }
    } catch (err) {
      return cb(err);
    }
    cb(null, session);
  }

  set(sid, session, cb) {
    const expires = this._expiredAt(session);
    const sess = JSON.stringify(session);
    try {
      db.prepare(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`
      ).run(sid, sess, expires);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, session, cb) {
    try {
      db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(this._expiredAt(session), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  cleanup() {
    try {
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    } catch {
      /* cleanup must never crash requests */
    }
  }
}

module.exports = SqliteSessionStore;