// Seller dashboard: listings + sales management.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireRole } = require('../middleware');
const { deleteImage, deleteDeliverable } = require('../storage');
const listing = require('../listing');

const router = express.Router();
const CATEGORIES = ['feet', 'hands', 'toys', 'other'];

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

// Keep uploads in memory so we can hand the buffer to Cloudinary or disk.
// `images` = public preview photos (images only); `deliverables` = the private
// files the buyer downloads after paying (any file type).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 16 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'images') return cb(null, /^image\//.test(file.mimetype));
    return cb(null, true); // deliverables: allow any file type
  },
}).fields([
  { name: 'images', maxCount: 6 },
  { name: 'deliverables', maxCount: 10 },
]);

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

const filesOf = (req, field) => (req.files && req.files[field]) || [];
const isBlurOn = (req) => req.body.blur_previews === 'on' || req.body.blur_previews === '1';

// --- Dashboard --------------------------------------------------------------
router.get('/', async (req, res) => {
  const listings = await attachThumb(
    await db.all('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC', req.user.id)
  );
  const sales = await db.all(
    `SELECT o.*, p.title, COALESCE(b.display_name, o.contact, 'Guest') AS buyer_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       LEFT JOIN users b ON b.id = o.buyer_id
      WHERE o.seller_id = ?
      ORDER BY o.created_at DESC`,
    req.user.id
  );
  const needsHandles = !req.user.cashapp && !req.user.venmo && !req.user.paypal;
  res.render('seller/dashboard', { title: 'Seller dashboard', listings, sales, needsHandles });
});

// --- New listing ------------------------------------------------------------
router.get('/new', (req, res) => {
  res.render('seller/edit', { title: 'New listing', product: null, images: [], deliverables: [], categories: CATEGORIES, error: null });
});

router.post('/new', upload, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
  const priceCents = priceToCents(req.body.price);

  if (!title || !Number.isFinite(priceCents)) {
    return res.render('seller/edit', {
      title: 'New listing',
      product: { title, description, category, price: req.body.price },
      images: [],
      deliverables: [],
      categories: CATEGORIES,
      error: 'A title and a valid price are required.',
    });
  }

  const blur = isBlurOn(req);
  const info = await db.run(
    'INSERT INTO products (seller_id, title, description, price_cents, category, blur_previews) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id,
    title,
    description,
    priceCents,
    category,
    blur ? 1 : 0
  );
  const productId = Number(info.lastInsertRowid);
  const { nextDel } = await listing.saveImages(filesOf(req, 'images'), productId, blur, 0, 0);
  await listing.saveDeliverables(filesOf(req, 'deliverables'), productId, nextDel);

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
  const deliverables = await db.all('SELECT * FROM deliverables WHERE product_id = ? ORDER BY position, id', product.id);
  res.render('seller/edit', {
    title: 'Edit listing',
    product: { ...product, price: (product.price_cents / 100).toFixed(2) },
    images,
    deliverables,
    categories: CATEGORIES,
    error: null,
  });
});

router.post('/:id/edit', upload, async (req, res) => {
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
    const deliverables = await db.all('SELECT * FROM deliverables WHERE product_id = ? ORDER BY position, id', product.id);
    return res.render('seller/edit', {
      title: 'Edit listing',
      product: { ...product, title, description, category, price: req.body.price, status },
      images,
      deliverables,
      categories: CATEGORIES,
      error: 'A title and a valid price are required.',
    });
  }

  const blur = isBlurOn(req);
  await db.run(
    'UPDATE products SET title = ?, description = ?, price_cents = ?, category = ?, status = ?, blur_previews = ? WHERE id = ?',
    title,
    description,
    priceCents,
    category,
    status,
    blur ? 1 : 0,
    product.id
  );

  const imgRow = await db.get('SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?', product.id);
  const delRow = await db.get('SELECT COALESCE(MAX(position), -1) AS m FROM deliverables WHERE product_id = ?', product.id);
  const { nextDel } = await listing.saveImages(
    filesOf(req, 'images'),
    product.id,
    blur,
    Number(imgRow.m) + 1,
    Number(delRow.m) + 1
  );
  await listing.saveDeliverables(filesOf(req, 'deliverables'), product.id, nextDel);

  // If blur is on, also blur any existing clear photos (deliver their originals).
  let extra = '';
  if (blur) {
    const converted = await listing.applyBlurToExisting(product.id);
    if (converted) extra = ' ' + converted + ' existing photo' + (converted > 1 ? 's were' : ' was') + ' blurred — the clear original' + (converted > 1 ? 's are' : ' is') + ' now in delivery files.';
  }
  flash(req, 'success', '✓ Changes saved.' + extra);
  res.redirect('/seller/' + product.id + '/edit');
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

// --- Delete a deliverable ---------------------------------------------------
router.post('/:id/deliverable/:did/delete', async (req, res) => {
  const product = await ownProduct(req);
  if (!product) return res.status(404).render('error', { title: 'Not found', message: 'Listing not found.' });
  const d = await db.get('SELECT * FROM deliverables WHERE id = ? AND product_id = ?', req.params.did, product.id);
  if (d) {
    await db.run('DELETE FROM deliverables WHERE id = ?', d.id);
    await deleteDeliverable(d);
  }
  res.redirect('/seller/' + product.id + '/edit');
});

// --- Delete a listing -------------------------------------------------------
router.post('/:id/delete', async (req, res) => {
  const product = await ownProduct(req);
  if (!product) return res.status(404).render('error', { title: 'Not found', message: 'Listing not found.' });
  const imgs = await db.all('SELECT * FROM product_images WHERE product_id = ?', product.id);
  const dels = await db.all('SELECT * FROM deliverables WHERE product_id = ?', product.id);
  await db.run('DELETE FROM products WHERE id = ?', product.id);
  for (const im of imgs) await deleteImage(im);
  for (const d of dels) await deleteDeliverable(d);
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
