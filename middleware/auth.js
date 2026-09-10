function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireLecturer(req, res, next) {
  if (!req.session.user || !['lecturer', 'administrator'].includes(req.session.user.accountType)) {
    req.flash('error', 'Lecturer/administrator access only.');
    return res.redirect('/dashboard');
  }
  next();
}

function requireSuperAdmin(db) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    const user = db.prepare(
      'SELECT id, account_type, can_manage_users, is_primary_admin FROM users WHERE id = ?'
    ).get(req.session.user.id);
    if (!user || !user.can_manage_users || !['administrator'].includes(user.account_type)) {
      req.flash('error', 'Only an administrator with user-management rights can access this page.');
      return res.redirect('/dashboard');
    }
    req.session.user.accountType = user.account_type;
    req.session.user.canManageUsers = !!user.can_manage_users;
    req.session.user.isPrimaryAdmin = !!user.is_primary_admin;
    next();
  };
}

module.exports = { requireLogin, requireLecturer, requireSuperAdmin };
