// Public storefront: browse, product detail, checkout (guest or member), buyer orders.
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware');
const { deliverableUrl, deliverableDiskPath } = require('../storage');
const chat = require('../chat');

const router = express.Router();
const CATEGORIES = ['feet', 'hands', 'toys', 'other'];
const CATEGORY_LABELS = { feet: 'Feet pics', hands: 'Hand pics', toys: 'Toys & items', other: 'Other' };

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

// Attach the first image (thumbnail URL) to a list of products.
async function withThumbnails(products) {
  for (const p of products) {
    const img = await db.get(
      'SELECT url FROM product_images WHERE product_id = ? ORDER BY position, id LIMIT 1',
      p.id
    );
    p.thumb = img ? img.url : null;
  }
  return products;
}

// --- Home / browse ----------------------------------------------------------
router.get('/', async (req, res) => {
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const q = String(req.query.q || '').trim();

  let sql =
    `SELECT p.*, u.display_name AS seller_name
       FROM products p JOIN users u ON u.id = p.seller_id
      WHERE p.status = 'active'`;
  const params = [];
  if (category) {
    sql += ' AND p.category = ?';
    params.push(category);
  }
  if (q) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = await withThumbnails(await db.all(sql, ...params));
  res.render('index', {
    title: 'Browse',
    products,
    category,
    q,
    categories: CATEGORIES,
    categoryLabels: CATEGORY_LABELS,
  });
});

// --- Public seller storefront (the shareable "my store" link) ---------------
router.get('/store/:id', async (req, res) => {
  const seller = await db.get('SELECT id, display_name, bio FROM users WHERE id = ?', req.params.id);
  if (!seller) {
    return res.status(404).render('error', { title: 'Not found', message: 'That store does not exist.' });
  }
  const products = await withThumbnails(
    await db.all(
      `SELECT p.*, u.display_name AS seller_name
         FROM products p JOIN users u ON u.id = p.seller_id
        WHERE p.seller_id = ? AND p.status = 'active'
        ORDER BY p.created_at DESC`,
      seller.id
    )
  );
  // Load this visitor's conversation with the seller (for the on-page chat box).
  const isOwner = !!req.user && req.user.id === seller.id;
  let conv = null;
  let messages = [];
  if (!isOwner) {
    conv = await chat.findConversationForVisitor(seller.id, req);
    if (conv) messages = await chat.getMessages(conv.id);
  }
  res.render('store', {
    title: seller.display_name,
    seller,
    products,
    categoryLabels: CATEGORY_LABELS,
    isOwner,
    conv,
    messages,
  });
});

// --- Product detail ---------------------------------------------------------
router.get('/product/:id', async (req, res) => {
  const product = await db.get(
    `SELECT p.*, u.display_name AS seller_name, u.bio AS seller_bio,
            u.cashapp, u.venmo, u.paypal
       FROM products p JOIN users u ON u.id = p.seller_id
      WHERE p.id = ?`,
    req.params.id
  );
  if (!product) {
    return res.status(404).render('error', { title: 'Not found', message: 'That item does not exist.' });
  }
  const images = await db.all(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id',
    product.id
  );
  res.render('product', {
    title: product.title,
    product,
    images,
    categoryLabels: CATEGORY_LABELS,
  });
});

// --- Checkout ---------------------------------------------------------------
function paymentOptions(seller) {
  const opts = [];
  if (seller.cashapp) opts.push({ key: 'cashapp', label: 'Cash App', handle: seller.cashapp });
  if (seller.venmo) opts.push({ key: 'venmo', label: 'Venmo', handle: seller.venmo });
  if (seller.paypal) opts.push({ key: 'paypal', label: 'PayPal', handle: seller.paypal });
  return opts;
}

// Checkout is open to guests. Signed-in users skip re-entering contact.
router.get('/product/:id/checkout', async (req, res) => {
  const product = await db.get(
    `SELECT p.*, u.display_name AS seller_name, u.cashapp, u.venmo, u.paypal
       FROM products p JOIN users u ON u.id = p.seller_id
      WHERE p.id = ?`,
    req.params.id
  );
  if (!product || product.status !== 'active') {
    return res.status(404).render('error', { title: 'Unavailable', message: 'That item is not available.' });
  }
  if (req.user && product.seller_id === req.user.id) {
    return res.render('error', { title: 'Heads up', message: "You can't buy your own listing." });
  }
  const options = paymentOptions(product);
  res.render('checkout', { title: 'Checkout', product, options, error: null });
});

router.post('/product/:id/checkout', async (req, res) => {
  const product = await db.get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!product || product.status !== 'active') {
    return res.status(404).render('error', { title: 'Unavailable', message: 'That item is not available.' });
  }
  if (req.user && product.seller_id === req.user.id) {
    return res.render('error', { title: 'Heads up', message: "You can't buy your own listing." });
  }
  const seller = await db.get('SELECT * FROM users WHERE id = ?', product.seller_id);
  const options = paymentOptions(seller);
  const method = req.body.payment_method;
  const contact = String(req.body.contact || '').trim();
  const note = String(req.body.note || '').trim();

  const rerender = (error) => res.render('checkout', { title: 'Checkout', product, options, error });
  if (!options.find((o) => o.key === method)) {
    return rerender('Please choose a payment method.');
  }
  // Guests must leave contact info so the seller can deliver / reach them.
  if (!req.user && !contact) {
    return rerender('Please add your contact (email, phone, or app username) so the seller can reach you.');
  }

  const token = crypto.randomBytes(16).toString('hex');
  const info = await db.run(
    `INSERT INTO orders (buyer_id, seller_id, product_id, amount_cents, payment_method, contact, note, access_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req.user ? req.user.id : null,
    product.seller_id,
    product.id,
    product.price_cents,
    method,
    contact,
    note,
    token
  );

  flash(req, 'success', 'Order placed! Send your payment, then the seller will confirm it.');
  const id = Number(info.lastInsertRowid);
  // Guests get a tokenized link they can bookmark to check status.
  res.redirect(req.user ? '/orders/' + id : '/orders/' + id + '?t=' + token);
});

// --- Buyer orders -----------------------------------------------------------
router.get('/orders', requireLogin, async (req, res) => {
  const orders = await db.all(
    `SELECT o.*, p.title, u.display_name AS seller_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users u ON u.id = o.seller_id
      WHERE o.buyer_id = ?
      ORDER BY o.created_at DESC`,
    req.user.id
  );
  res.render('orders', { title: 'My orders', orders });
});

router.get('/orders/:id', async (req, res) => {
  const order = await db.get(
    `SELECT o.*, p.title, p.category,
            s.display_name AS seller_name, s.cashapp, s.venmo, s.paypal,
            COALESCE(b.display_name, 'Guest') AS buyer_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users s ON s.id = o.seller_id
       LEFT JOIN users b ON b.id = o.buyer_id
      WHERE o.id = ?`,
    req.params.id
  );
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  const tokenOk = req.query.t && order.access_token && req.query.t === order.access_token;
  const isSeller = !!req.user && (req.user.id === order.seller_id || req.user.role === 'admin');
  const isBuyer = (!!req.user && req.user.id === order.buyer_id) || tokenOk;
  if (!isSeller && !isBuyer) {
    // Not logged in as a party and no valid token: send guests to log in.
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot view this order.' });
  }
  const handleMap = { cashapp: order.cashapp, venmo: order.venmo, paypal: order.paypal };
  const deliverables = await db.all(
    'SELECT id, original_name FROM deliverables WHERE product_id = ? ORDER BY position, id',
    order.product_id
  );
  const unlocked = order.status === 'paid' || order.status === 'shipped';
  res.render('order', {
    title: 'Order #' + order.id,
    order,
    handle: handleMap[order.payment_method],
    isSeller,
    isBuyer,
    deliverables,
    unlocked,
    downloadSuffix: req.query.t ? '?t=' + encodeURIComponent(req.query.t) : '',
  });
});

// --- Download a purchased deliverable (gated: order must be paid) -----------
router.get('/orders/:id/download/:did', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  const tokenOk = req.query.t && order.access_token && req.query.t === order.access_token;
  const isSeller = !!req.user && (req.user.id === order.seller_id || req.user.role === 'admin');
  const isBuyer = (!!req.user && req.user.id === order.buyer_id) || tokenOk;
  if (!isSeller && !isBuyer) {
    if (!req.user) {
      req.session.returnTo = '/orders/' + order.id + (req.query.t ? '?t=' + req.query.t : '');
      return res.redirect('/login');
    }
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot access this order.' });
  }
  // Buyers only get files once the seller has confirmed payment. Sellers/admin can always fetch.
  const unlocked = order.status === 'paid' || order.status === 'shipped';
  if (isBuyer && !isSeller && !unlocked) {
    return res.status(403).render('error', {
      title: 'Not unlocked yet',
      message: 'Your files unlock once the seller confirms your payment.',
    });
  }
  const d = await db.get('SELECT * FROM deliverables WHERE id = ? AND product_id = ?', req.params.did, order.product_id);
  if (!d) {
    return res.status(404).render('error', { title: 'Not found', message: 'File not found.' });
  }
  if (d.storage === 'cloudinary') {
    return res.redirect(deliverableUrl(d));
  }
  return res.download(deliverableDiskPath(d), d.original_name || 'download');
});

module.exports = router;
