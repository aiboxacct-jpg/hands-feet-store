// Buyer <-> seller messaging: start from a store page, inbox, thread, reply.
const express = require('express');
const db = require('../db');
const chat = require('../chat');
const { tipLinks } = require('../tips');

const router = express.Router();
const MAX = 2000;

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

// Send a message from a seller's store page (creates the conversation if new).
router.post('/start', async (req, res) => {
  const sellerId = Number(req.body.seller_id);
  const body = String(req.body.body || '').trim();
  const name = String(req.body.name || '').trim();
  const seller = await db.get('SELECT id FROM users WHERE id = ?', sellerId);
  if (!seller) return res.status(404).render('error', { title: 'Not found', message: 'Seller not found.' });
  if (req.user && req.user.id === sellerId) {
    flash(req, 'error', "That's your own store — check your Messages inbox to reply to buyers.");
    return res.redirect('/store/' + sellerId);
  }
  if (!body) {
    flash(req, 'error', 'Type a message first.');
    return res.redirect('/store/' + sellerId + '#chat');
  }
  const conv = await chat.findOrCreateConversation(sellerId, req, name);
  await chat.addMessage(conv.id, 'buyer', body.slice(0, MAX));
  flash(req, 'success', 'Message sent! The seller will see it in their inbox.');
  res.redirect('/store/' + sellerId + '#chat');
});

// Inbox — all of the viewer's conversations (as seller and/or buyer, or guest).
router.get('/', async (req, res) => {
  let convs;
  if (req.user) {
    convs = await db.all(
      `SELECT c.*, s.display_name AS seller_name
         FROM conversations c JOIN users s ON s.id = c.seller_id
        WHERE c.seller_id = ? OR c.buyer_user_id = ?
        ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      req.user.id,
      req.user.id
    );
  } else {
    convs = await db.all(
      `SELECT c.*, s.display_name AS seller_name
         FROM conversations c JOIN users s ON s.id = c.seller_id
        WHERE c.guest_id = ?
        ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      req.gid
    );
  }
  for (const c of convs) {
    const last = await db.get('SELECT body FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', c.id);
    c.last_body = last ? last.body : '';
    c.iamSeller = !!req.user && req.user.id === c.seller_id;
    c.other = c.iamSeller ? c.buyer_name || 'Buyer' : c.seller_name;
  }
  res.render('messages/inbox', { title: 'Messages', conversations: convs });
});

// A single conversation thread.
router.get('/:id', async (req, res) => {
  const conv = await db.get(
    `SELECT c.*, s.display_name AS seller_name, s.cashapp, s.venmo, s.paypal
       FROM conversations c JOIN users s ON s.id = c.seller_id WHERE c.id = ?`,
    req.params.id
  );
  if (!conv) return res.status(404).render('error', { title: 'Not found', message: 'Conversation not found.' });
  const acc = chat.access(conv, req);
  if (!acc.ok) {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot view this conversation.' });
  }
  const messages = await chat.getMessages(conv.id);
  await chat.markRead(conv, req); // opening the thread clears its unread badge
  res.render('messages/thread', {
    title: acc.isSeller ? 'Chat with ' + (conv.buyer_name || 'Buyer') : 'Chat with ' + conv.seller_name,
    conv,
    messages,
    isSeller: acc.isSeller,
    // The buyer can tip the seller from inside the private chat.
    tips: acc.isSeller ? [] : tipLinks(conv),
    tokenSuffix: req.query.t ? '?t=' + encodeURIComponent(req.query.t) : '',
  });
});

// Post a reply within a thread.
router.post('/:id/reply', async (req, res) => {
  const conv = await db.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conv) return res.status(404).render('error', { title: 'Not found', message: 'Conversation not found.' });
  const acc = chat.access(conv, req);
  if (!acc.ok) {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot reply here.' });
  }
  const body = String(req.body.body || '').trim();
  if (body) await chat.addMessage(conv.id, acc.isSeller ? 'seller' : 'buyer', body.slice(0, MAX));
  res.redirect('/messages/' + conv.id + (req.query.t ? '?t=' + encodeURIComponent(req.query.t) : ''));
});

module.exports = router;
