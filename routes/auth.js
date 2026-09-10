const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

module.exports = function createAuthRoutes(config) {
  const { db, rateLimit, absoluteUrl, normalizeEmail, validPassword, emailService, baseUrl } = config;
  const router = express.Router();
  const { VERIFICATION_EXPIRY_HOURS, RESET_EXPIRY_MINUTES } = emailService;

  // ---- Register ----
  router.get('/register', (req, res) => {
    res.render('register', { departments: config.getDepartments() });
  });

  router.post('/register', rateLimit({ max: 5 }), async (req, res) => {
    const full_name = String(req.body.full_name || '').trim();
    const registration_number = String(req.body.registration_number || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    const department_id = parseInt(req.body.department_id, 10);
    const d = Number.isInteger(department_id)
      ? db.prepare('SELECT id, name, faculty_id FROM departments WHERE id = ?').get(department_id)
      : null;

    if (!full_name || !email || !password || !d || !registration_number) {
      req.flash('error', 'Please fill in all required fields and select a valid department.');
      return res.redirect('/register');
    }
    if (!validPassword(password)) {
      req.flash('error', 'Password must be at least 8 characters long.');
      return res.redirect('/register');
    }
    if (db.prepare('SELECT id FROM users WHERE email = ? OR registration_number = ?').get(email, registration_number)) {
      req.flash('error', 'An account with that email or registration number already exists.');
      return res.redirect('/register');
    }

    const hash = bcrypt.hashSync(password, 12);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 3600 * 1000).toISOString();

    db.prepare(
      `INSERT INTO users(full_name, matric_or_staff_no, registration_number, email, password, department, department_id, faculty_id, role, account_type, email_verified, verification_token, verification_expires)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'student', 'student', 0, ?, ?)`
    ).run(full_name, registration_number, registration_number, email, hash, d.name, d.id, d.faculty_id, token, expires);

    const verifyUrl = absoluteUrl(req, `/verify/${token}`, baseUrl);
    const emailResult = await emailService.sendVerificationEmail(email, full_name, verifyUrl);
    res.render('verify_notice', { email, verifyUrl, emailSent: emailResult.sent });
  });

  // ---- Email Verification ----
  router.get('/verify/:token', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE verification_token = ?').get(req.params.token);
    if (!user) {
      req.flash('error', 'That verification link is invalid or has already been used.');
      return res.redirect('/login');
    }
    if (!user.verification_expires || new Date(user.verification_expires) < new Date()) {
      req.flash('error', 'That verification link has expired. Request a new link.');
      return res.redirect('/resend-verification');
    }
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?').run(user.id);
    req.flash('success', 'Your email has been verified. You can now log in.');
    res.redirect('/login');
  });

  // ---- Resend Verification ----
  router.get('/resend-verification', (req, res) => {
    res.render('resend_verification');
  });

  router.post('/resend-verification', rateLimit({ max: 5 }), async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      req.flash('error', 'No account found with that email address.');
      return res.redirect('/resend-verification');
    }
    if (user.email_verified) {
      req.flash('success', 'That email is already verified. Please log in.');
      return res.redirect('/login');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 3600 * 1000).toISOString();
    db.prepare('UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?').run(token, expires, user.id);
    const verifyUrl = absoluteUrl(req, `/verify/${token}`, baseUrl);
    const emailResult = await emailService.sendVerificationEmail(user.email, user.full_name, verifyUrl);
    res.render('verify_notice', { email: user.email, verifyUrl, emailSent: emailResult.sent });
  });

  // ---- Login ----
  router.get('/login', (req, res) => {
    res.render('login');
  });

  router.post('/login', rateLimit({ max: 8 }), (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password || '';
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    if (!user.email_verified) {
      req.flash('error', 'Please verify your email before logging in.');
      return res.redirect('/login');
    }
    req.session.regenerate(err => {
      if (err) return res.status(500).send('Unable to start session.');
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.user = {
        id: user.id,
        full_name: user.full_name,
        accountType: user.account_type || (user.role === 'admin'
          ? (user.can_manage_users ? 'administrator' : 'lecturer')
          : 'student'),
        department: user.department,
        canManageUsers: !!user.can_manage_users,
        isPrimaryAdmin: !!user.is_primary_admin
      };
      res.redirect('/dashboard');
    });
  });

  // ---- Forgot Password ----
  router.get('/forgot-password', (req, res) => {
    res.render('forgot_password');
  });

  router.post('/forgot-password', rateLimit({ max: 5 }), async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Deliberately show the same response whether the account exists.
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expires = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(tokenHash, expires, user.id);
      const resetUrl = absoluteUrl(req, `/reset-password/${rawToken}`, baseUrl);
      const emailResult = await emailService.sendPasswordResetEmail(user.email, user.full_name, resetUrl);
      if (!emailResult.sent && !emailService.RESEND_API_KEY) {
        console.log(`[password-reset] Demo reset link: ${resetUrl}`);
      }
    }
    res.render('forgot_notice', { email });
  });

  // ---- Reset Password ----
  router.get('/reset-password/:token', (req, res) => {
    res.render('reset_password', { token: req.params.token });
  });

  router.post('/reset-password/:token', rateLimit({ max: 8 }), (req, res) => {
    const { new_password, confirm_password } = req.body;
    if (!validPassword(new_password)) {
      req.flash('error', 'Password must be at least 8 characters long.');
      return res.redirect(`/reset-password/${encodeURIComponent(req.params.token)}`);
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect(`/reset-password/${encodeURIComponent(req.params.token)}`);
    }
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(tokenHash);
    if (!user || !user.reset_expires || new Date(user.reset_expires) < new Date()) {
      req.flash('error', 'That password reset link is invalid or expired.');
      return res.redirect('/forgot-password');
    }
    const hash = bcrypt.hashSync(new_password, 12);
    db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hash, user.id);
    req.flash('success', 'Password reset successfully. You can now log in.');
    res.redirect('/login');
  });

  // ---- Logout ----
  router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ---- Change Password ----
  const { requireLogin } = require('../middleware/auth');

  router.get('/change-password', requireLogin, (req, res) => {
    res.render('change_password');
  });

  router.post('/change-password', requireLogin, (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !bcrypt.compareSync(current_password || '', user.password)) {
      req.flash('error', 'Your current password is incorrect.');
      return res.redirect('/change-password');
    }
    if (!validPassword(new_password)) {
      req.flash('error', 'New password must be at least 8 characters long.');
      return res.redirect('/change-password');
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'New password and confirmation do not match.');
      return res.redirect('/change-password');
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 12), user.id);
    req.flash('success', 'Password updated successfully.');
    res.redirect('/dashboard');
  });

  return router;
};
