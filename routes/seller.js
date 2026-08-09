// Seller dashboard: listings + sales management.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireRole } = require('../middleware');
const { uploadImage, deleteImage } = require('../storage');

const router = express.Router();
const CATEGORIES = ['feet', 'hands', 'toys', 'other'];

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

// Keep uploads in memory so we can hand the buffer to Cloudinary or disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Every route here requires a seller (or admin).
router.use(requireRole('seller', 'admin'));

function priceToCents(input) {
  const n = Math.round(parseFloat(String(input).replace(/[^0-9.]/g, '')) * 100);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

async function attachThumb(products) {
  for (const p of products) {
    const img = await db.get(
      'SELECT url FROM product_images WHERE product_id = ? ORDER BY position, id LIMIT 1',
      p.id
    );
    p.thumb = img ? img.url : null;
  }
  return products;
}

async function saveImages(files, productId, startPos) {
  let pos = startPos;
  for (const f of files || []) {
    const { url, public_id } = await uploadImage(f.buffer, f.originalname);
    await db.run(
      'INSERT INTO product_images (product_id, url, public_id, position) VALUES (?, ?, ?, ?)',
      productId,
      url,
      public_id,
      pos++
    );
  }
}

// --- Dashboard --------------------------------------------------------------
router.get('/', async (req, res) => {
  const listings = await attachThumb(
    await db.all('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC', req.user.id)
  );
  const sales = await db.all(
    `SELECT o.*, p.title, b.display_name AS buyer_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users b ON b.id = o.buyer_id
      WHERE o.seller_id = ?
      ORDER BY o.created_at DESC`,
    req.user.id
  );
  const needsHandles = !req.user.cashapp && !req.user.venmo && !req.user.paypal;
  res.render('seller/dashboard', { title: 'Seller dashboard', listings, sales, needsHandles });
});

// --- New listing ------------------------------------------------------------
router.get('/new', (req, res) => {
  res.render('seller/edit', { title: 'New listing', product: null, images: [], categories: CATEGORIES, error: null });
});

router.post('/new', upload.array('images', 6), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
  const priceCents = priceToCents(req.body.price);

  if (!title || !Number.isFinite(priceCents)) {
    return res.render('seller/edit', {
      title: 'New listing',
      product: { title, description, category, price: req.body.price },
      images: [],
      categories: CATEGORIES,
      error: 'A title and a valid price are required.',
    });
  }

  const info = await db.run(
    'INSERT INTO products (seller_id, title, description, price_cents, category) VALUES (?, ?, ?, ?, ?)',
    req.user.id,
    title,
    description,
    priceCents,
    category
  );
  await saveImages(req.files, Number(info.lastInsertRowid), 0);

  flash(req, 'success', 'Listing published.');
  res.redirect('/seller');
});

// Load a product the current seller owns, or null.
async function ownProduct(req) {
  const p = await db.get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!p) return null;
  if (p.seller_id !== req.user.id && req.user.role !== 'admin') return null;
  return p;
}

// --- Edit listing -----------------------------------------------------------
router.get('/:id/edit', async (req, res) => {
  const product = await ownProduct(req);
  if (!product) return res.status(404).render('error', { title: 'Not found', message: 'Listing not found.' });
  const images = await db.all('SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id', product.id);
  res.render('seller/edit', {
    title: 'Edit listing',
    product: { ...product, price: (product.price_cents / 100).toFixed(2) },
    images,
    categories: CATEGORIES,
    error: null,
  });
});

router.post('/:id/edit', upload.array('images', 6), async (req, res) => {
  const product = await ownProduct(req);
  if (!product) {
    return res.status(404).render('error', { title: 'Not found', message: 'Listing not found.' });
  }
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : product.category;
  const priceCents = priceToCents(req.body.price);
  const status = ['active', 'sold', 'hidden'].includes(req.body.status) ? req.body.status : product.status;

  if (!title || !Number.isFinite(priceCents)) {
    const images = await db.all('SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id', product.id);
    return res.render('seller/edit', {
      title: 'Edit listing',
      product: { ...product, title, description, category, price: req.body.price, status },
      images,
      categories: CATEGORIES,
      error: 'A title and a valid price are required.',
    });
  }

  await db.run(
    'UPDATE products SET title = ?, description = ?, price_cents = ?, category = ?, status = ? WHERE id = ?',
    title,
    description,
    priceCents,
    category,
    status,
    product.id
  );

  const row = await db.get('SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?', product.id);
  await saveImages(req.files, product.id, Number(row.m) + 1);

  flash(req, 'success', 'Listing updated.');
  res.redirect('/seller');
});

// --- Delete an image --------------------------------------------------------
router.post('/:id/image/:imageId/delete', async (req, res) => {
  const product = await ownProduct(req);
  if (!product) return res.status(404).render('error', { title: 'Not found', message: 'Listing not found.' });
  const img = await db.get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', req.params.imageId, product.id);
  if (img) {
    await db.run('DELETE FROM product_images WHERE id = ?', img.id);
    await deleteImage(img);
  }
  res.redirect('/seller/' + product.id + '/edit');
});

// --- Delete a listing -------------------------------------------------------
router.post('/:id/delete', async (req, res) => {
  const product = await ownProduct(req);
  if (!product) return res.status(404).render('error', { title: 'Not found', message: 'Listing not found.' });
  const imgs = await db.all('SELECT * FROM product_images WHERE product_id = ?', product.id);
  await db.run('DELETE FROM products WHERE id = ?', product.id);
  for (const im of imgs) await deleteImage(im);
  flash(req, 'success', 'Listing deleted.');
  res.redirect('/seller');
});

// --- Update an order's status (seller side) ---------------------------------
router.post('/orders/:id/status', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order || (order.seller_id !== req.user.id && req.user.role !== 'admin')) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  const status = ['pending', 'paid', 'shipped', 'cancelled'].includes(req.body.status) ? req.body.status : order.status;
  await db.run('UPDATE orders SET status = ? WHERE id = ?', status, order.id);
  flash(req, 'success', 'Order marked as ' + status + '.');
  res.redirect('/seller');
});

module.exports = router;
