// Register, login, logout, and account settings.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware');

const router = express.Router();

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

// --- Register ---------------------------------------------------------------
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Create account', values: {}, error: null });
});

router.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const displayName = String(req.body.display_name || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'seller' ? 'seller' : 'buyer';
  const values = { email, display_name: displayName, role };

  if (!email || !displayName || !password) {
    return res.render('register', { title: 'Create account', values, error: 'All fields are required.' });
  }
  if (password.length < 6) {
    return res.render('register', { title: 'Create account', values, error: 'Password must be at least 6 characters.' });
  }
  const exists = await db.get('SELECT id FROM users WHERE email = ?', email);
  if (exists) {
    return res.render('register', { title: 'Create account', values, error: 'That email is already registered.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = await db.run(
    'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
    email,
    hash,
    displayName,
    role
  );

  req.session.userId = Number(info.lastInsertRowid);
  req.session.ageConfirmed = true;
  flash(req, 'success', 'Welcome! Your account is ready.');
  res.redirect(role === 'seller' ? '/seller' : '/');
});

// --- Login ------------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Log in', error: null, email: '' });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { title: 'Log in', error: 'Invalid email or password.', email });
  }
  req.session.userId = user.id;
  req.session.ageConfirmed = true;
  const dest = req.session.returnTo || (user.role === 'admin' ? '/admin' : user.role === 'seller' ? '/seller' : '/');
  delete req.session.returnTo;
  res.redirect(dest);
});

// --- Logout -----------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Account settings -------------------------------------------------------
router.get('/account', requireLogin, (req, res) => {
  res.render('account', { title: 'My account', error: null });
});

router.post('/account', requireLogin, async (req, res) => {
  const displayName = String(req.body.display_name || '').trim();
  const bio = String(req.body.bio || '').trim();
  const cashapp = String(req.body.cashapp || '').trim();
  const venmo = String(req.body.venmo || '').trim();
  const paypal = String(req.body.paypal || '').trim();
  if (!displayName) {
    return res.render('account', { title: 'My account', error: 'Display name is required.' });
  }
  await db.run(
    'UPDATE users SET display_name = ?, bio = ?, cashapp = ?, venmo = ?, paypal = ? WHERE id = ?',
    displayName,
    bio,
    cashapp,
    venmo,
    paypal,
    req.user.id
  );
  flash(req, 'success', 'Account updated.');
  res.redirect('/account');
});

// Let a buyer become a seller.
router.post('/become-seller', requireLogin, async (req, res) => {
  if (req.user.role === 'buyer') {
    await db.run("UPDATE users SET role = 'seller' WHERE id = ?", req.user.id);
    flash(req, 'success', 'You can now list items for sale.');
  }
  res.redirect('/seller');
});

module.exports = router;
