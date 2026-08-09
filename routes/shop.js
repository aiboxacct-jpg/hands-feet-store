// Public storefront: browse, product detail, checkout, buyer orders.
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware');

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

router.get('/product/:id/checkout', requireLogin, async (req, res) => {
  const product = await db.get(
    `SELECT p.*, u.display_name AS seller_name, u.cashapp, u.venmo, u.paypal
       FROM products p JOIN users u ON u.id = p.seller_id
      WHERE p.id = ?`,
    req.params.id
  );
  if (!product || product.status !== 'active') {
    return res.status(404).render('error', { title: 'Unavailable', message: 'That item is not available.' });
  }
  if (product.seller_id === req.user.id) {
    return res.render('error', { title: 'Heads up', message: "You can't buy your own listing." });
  }
  const options = paymentOptions(product);
  res.render('checkout', { title: 'Checkout', product, options, error: null });
});

router.post('/product/:id/checkout', requireLogin, async (req, res) => {
  const product = await db.get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!product || product.status !== 'active') {
    return res.status(404).render('error', { title: 'Unavailable', message: 'That item is not available.' });
  }
  if (product.seller_id === req.user.id) {
    return res.render('error', { title: 'Heads up', message: "You can't buy your own listing." });
  }
  const seller = await db.get('SELECT * FROM users WHERE id = ?', product.seller_id);
  const options = paymentOptions(seller);
  const method = req.body.payment_method;
  if (!options.find((o) => o.key === method)) {
    return res.render('checkout', { title: 'Checkout', product, options, error: 'Please choose a payment method.' });
  }
  const contact = String(req.body.contact || '').trim();
  const note = String(req.body.note || '').trim();

  const info = await db.run(
    `INSERT INTO orders (buyer_id, seller_id, product_id, amount_cents, payment_method, contact, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    req.user.id,
    product.seller_id,
    product.id,
    product.price_cents,
    method,
    contact,
    note
  );

  flash(req, 'success', 'Order placed! Send your payment, then the seller will confirm it.');
  res.redirect('/orders/' + Number(info.lastInsertRowid));
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

router.get('/orders/:id', requireLogin, async (req, res) => {
  const order = await db.get(
    `SELECT o.*, p.title, p.category,
            s.display_name AS seller_name, s.cashapp, s.venmo, s.paypal,
            b.display_name AS buyer_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users s ON s.id = o.seller_id
       JOIN users b ON b.id = o.buyer_id
      WHERE o.id = ?`,
    req.params.id
  );
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  const isParty = [order.buyer_id, order.seller_id].includes(req.user.id) || req.user.role === 'admin';
  if (!isParty) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot view this order.' });
  }
  const handleMap = { cashapp: order.cashapp, venmo: order.venmo, paypal: order.paypal };
  res.render('order', { title: 'Order #' + order.id, order, handle: handleMap[order.payment_method] });
});

module.exports = router;
