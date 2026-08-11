// Shared middleware: current user, auth guards, view helpers.
const db = require('./db');

// Attach the logged-in user (if any) to req.user and res.locals for views.
async function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.currentPath = req.path;
  if (req.session && req.session.userId) {
    const user = await db.get(
      'SELECT id, email, display_name, role, handle, cashapp, venmo, paypal, bio, locked FROM users WHERE id = ?',
      req.session.userId
    );
    if (user) {
      req.user = user;
      res.locals.user = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', {
        title: 'Not allowed',
        message: 'You do not have access to that page.',
      });
    }
    next();
  };
}

module.exports = { loadUser, requireLogin, requireRole };
