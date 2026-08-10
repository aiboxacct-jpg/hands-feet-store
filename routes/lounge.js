// Global public chat room ("the Lounge"). Anyone (incl. guests) can post.
const express = require('express');
const db = require('../db');

const router = express.Router();
const BODY_MAX = 500;
const NAME_MAX = 30;
const COOLDOWN_MS = 1200;

function nickFor(req) {
  return 'guest-' + String(req.gid || 'anon').slice(0, 4);
}
function displayName(req, provided) {
  if (req.user) return req.user.display_name;
  const n = String(provided || '').trim().slice(0, NAME_MAX);
  return n || nickFor(req);
}
function serialize(rows, req) {
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role || '',
    body: m.body,
    created_at: m.created_at,
    mine:
      (!!req.user && m.user_id === req.user.id) ||
      (!req.user && !!m.gid && m.gid === req.gid),
  }));
}
function wantsJson(req) {
  return (req.get('accept') || '').includes('application/json');
}

// Page
router.get('/', async (req, res) => {
  const rows = await db.all('SELECT * FROM global_messages ORDER BY id DESC LIMIT 100');
  rows.reverse();
  res.render('lounge', {
    title: 'Lounge',
    messages: serialize(rows, req),
    suggestedName: req.user ? req.user.display_name : nickFor(req),
    isGuest: !req.user,
    isAdmin: !!req.user && req.user.role === 'admin',
  });
});

// JSON feed of messages after a given id (for live polling)
router.get('/feed', async (req, res) => {
  const after = Number(req.query.after) || 0;
  const rows = await db.all('SELECT * FROM global_messages WHERE id > ? ORDER BY id LIMIT 200', after);
  res.json({ messages: serialize(rows, req) });
});

// Post a message
const lastPost = new Map();
router.post('/', async (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, BODY_MAX);
  const name = displayName(req, req.body.name);
  const json = wantsJson(req);
  if (!body) return json ? res.json({ ok: false, error: 'empty' }) : res.redirect('/lounge');

  const key = req.user ? 'u' + req.user.id : 'g' + req.gid;
  const now = Date.now();
  if (lastPost.get(key) && now - lastPost.get(key) < COOLDOWN_MS) {
    return json ? res.json({ ok: false, error: 'Slow down a moment.' }) : res.redirect('/lounge');
  }
  lastPost.set(key, now);

  const info = await db.run(
    'INSERT INTO global_messages (user_id, gid, name, role, body) VALUES (?, ?, ?, ?, ?)',
    req.user ? req.user.id : null,
    req.user ? null : req.gid,
    name,
    req.user ? req.user.role : '',
    body
  );
  if (json) {
    const m = await db.get('SELECT * FROM global_messages WHERE id = ?', Number(info.lastInsertRowid));
    return res.json({ ok: true, message: serialize([m], req)[0] });
  }
  res.redirect('/lounge');
});

// Admin: delete a message
router.post('/:id/delete', async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return wantsJson(req) ? res.status(403).json({ ok: false }) : res.status(403).render('error', { title: 'Not allowed', message: 'Admins only.' });
  }
  await db.run('DELETE FROM global_messages WHERE id = ?', req.params.id);
  return wantsJson(req) ? res.json({ ok: true }) : res.redirect('/lounge');
});

module.exports = router;
