// Main server entry point.
require('express-async-errors'); // lets async route handlers forward errors
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const db = require('./db');
const billing = require('./billing');
const { loadUser } = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy — needed so req.protocol is 'https' for share links.
app.set('trust proxy', 1);

// Ensure local upload dir exists (used only when not on Cloudinary).
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Views.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static assets and uploaded images.
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Body parsing (forms).
app.use(express.urlencoded({ extended: true }));

// Sessions (MemoryStore is fine for local single-process use).
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// Give every visitor a persistent "device id" cookie so a guest can be
// recognized across visits for messaging (independent of the session store).
app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)gid=([^;]+)/);
  let gid = m ? decodeURIComponent(m[1]) : null;
  if (!gid) {
    gid = crypto.randomBytes(16).toString('hex');
    res.cookie('gid', gid, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax' });
  }
  req.gid = gid;
  next();
});

// Make a money formatter and flash messages available to all views.
app.use((req, res, next) => {
  res.locals.storeName = process.env.STORE_NAME || 'My Store';
  res.locals.absUrl = (p) => `${req.protocol}://${req.get('host')}${p || ''}`;
  res.locals.money = (cents) => '$' + (Number(cents) / 100).toFixed(2);
  res.locals.flash = req.session.flash || null;
  delete (req.session || {}).flash;
  next();
});

app.use(loadUser);

// --- Age gate ---------------------------------------------------------------
// Require an 18+ confirmation (stored in the session) before browsing.
app.use((req, res, next) => {
  const exempt =
    req.path === '/age' ||
    req.path === '/login' ||
    req.path === '/register' ||
    req.path === '/start-selling' ||
    req.path === '/privacy' ||
    req.path === '/terms' ||
    req.path.startsWith('/public') ||
    req.path.startsWith('/uploads');
  if (req.session.ageConfirmed || exempt) return next();
  return res.render('age', {
    title: 'Age verification',
    layout: false,
    next: req.originalUrl,
  });
});

// --- Routes -----------------------------------------------------------------
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/shop'));
app.use('/messages', require('./routes/messages'));
app.use('/lounge', require('./routes/lounge'));
app.use('/start-selling', require('./routes/sell'));
app.use('/seller', require('./routes/seller'));
app.use('/admin', require('./routes/admin'));

// Age confirmation handler.
app.post('/age', (req, res) => {
  req.session.ageConfirmed = true;
  const next = typeof req.body.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/';
  res.redirect(next);
});

// 404.
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

// Error handler.
app.use((err, req, res, next) => {
  console.error(err);
  let status = 500;
  let title = 'Error';
  let message = 'Something went wrong. Please try again.';
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    title = 'File too large';
    message = 'That file is too large — photos and files can be up to 50 MB each. Try a smaller one.';
  } else if (err && err.name === 'MulterError') {
    status = 400;
    title = 'Upload problem';
    message = 'There was a problem with your upload. Please go back and try again (one photo at a time can help).';
  }
  res.status(status).render('error', { title, message });
});

db.init()
  .then(() => billing.loadSettings())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\nStore running at  http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to start: could not initialize the database.');
    console.error(err);
    process.exit(1);
  });
