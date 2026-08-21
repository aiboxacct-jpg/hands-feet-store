// Shared messaging helpers (used by the store page and the /messages routes).
const crypto = require('crypto');
const db = require('./db');

// The conversation between a seller and the current visitor (as a buyer), if any.
async function findConversationForVisitor(sellerId, req) {
  if (req.user) {
    return db.get('SELECT * FROM conversations WHERE seller_id = ? AND buyer_user_id = ?', sellerId, req.user.id);
  }
  return db.get('SELECT * FROM conversations WHERE seller_id = ? AND guest_id = ?', sellerId, req.gid);
}

async function findOrCreateConversation(sellerId, req, buyerName) {
  const existing = await findConversationForVisitor(sellerId, req);
  if (existing) return existing;
  const token = crypto.randomBytes(16).toString('hex');
  const name = (buyerName && buyerName.trim()) || (req.user ? req.user.display_name : 'Guest');
  const info = await db.run(
    `INSERT INTO conversations (seller_id, buyer_user_id, guest_id, buyer_name, access_token, last_message_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    sellerId,
    req.user ? req.user.id : null,
    req.user ? null : req.gid,
    name,
    token
  );
  return db.get('SELECT * FROM conversations WHERE id = ?', Number(info.lastInsertRowid));
}

async function addMessage(convId, sender, body) {
  await db.run('INSERT INTO messages (conversation_id, sender, body) VALUES (?, ?, ?)', convId, sender, body);
  await db.run("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?", convId);
}

function getMessages(convId) {
  return db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', convId);
}

// Mark this conversation as read for whichever side the viewer is on.
// (Admins viewing someone else's thread do NOT clear the real seller's unread.)
async function markRead(conv, req) {
  if (req.user && req.user.id === conv.seller_id) {
    await db.run("UPDATE conversations SET seller_read_at = datetime('now') WHERE id = ?", conv.id);
    return;
  }
  const isBuyer =
    (!!req.user && req.user.id === conv.buyer_user_id) ||
    (!req.user && !!conv.guest_id && conv.guest_id === req.gid) ||
    !!(req.query && req.query.t && conv.access_token && req.query.t === conv.access_token);
  if (isBuyer) {
    await db.run("UPDATE conversations SET buyer_read_at = datetime('now') WHERE id = ?", conv.id);
  }
}

// Total unread messages for the current viewer (across all their conversations).
// Unread = a message from the OTHER side newer than when this side last opened it.
async function unreadCount(req) {
  if (req.user) {
    const row = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.seller_id = ? AND m.sender = 'buyer'
              AND (c.seller_read_at IS NULL OR m.created_at > c.seller_read_at))
       + (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.buyer_user_id = ? AND m.sender = 'seller'
              AND (c.buyer_read_at IS NULL OR m.created_at > c.buyer_read_at)) AS n`,
      req.user.id,
      req.user.id
    );
    return row ? Number(row.n) || 0 : 0;
  }
  // Guest buyer, recognized by device cookie.
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.guest_id = ? AND m.sender = 'seller'
        AND (c.buyer_read_at IS NULL OR m.created_at > c.buyer_read_at)`,
    req.gid
  );
  return row ? Number(row.n) || 0 : 0;
}

// Who is the current viewer relative to this conversation?
function access(conv, req) {
  const tokenOk = !!(req.query && req.query.t && conv.access_token && req.query.t === conv.access_token);
  const isSeller = !!req.user && (req.user.id === conv.seller_id || req.user.role === 'admin');
  const isBuyer =
    (!!req.user && req.user.id === conv.buyer_user_id) ||
    (!req.user && !!conv.guest_id && conv.guest_id === req.gid) ||
    tokenOk;
  return { isSeller, isBuyer, ok: isSeller || isBuyer };
}

module.exports = { findConversationForVisitor, findOrCreateConversation, addMessage, getMessages, access, markRead, unreadCount };
