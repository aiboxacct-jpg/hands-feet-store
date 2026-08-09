// One-step "Start Selling": create account + payment handle + first listing together.
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { uploadImage, uploadDeliverable } = require('../storage');

const router = express.Router();
const CATEGORIES = ['feet', 'hands', 'toys', 'other'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 16 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'images') return cb(null, /^image\//.test(file.mimetype));
    return cb(null, true); // deliverables: any file type
  },
}).fields([
  { name: 'images', maxCount: 6 },
  { name: 'deliverables', maxCount: 10 },
]);

function priceToCents(input) {
  const n = Math.round(parseFloat(String(input).replace(/[^0-9.]/g, '')) * 100);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

router.get('/', (req, res) => {
  // Already signed in? Send members straight to the normal new-listing form.
  if (req.user) return res.redirect('/seller/new');
  res.render('sell/start', { title: 'Start selling', values: {}, categories: CATEGORIES, error: null });
});

router.post('/', upload, async (req, res) => {
  const b = req.body;
  const email = String(b.email || '').trim().toLowerCase();
  const displayName = String(b.display_name || '').trim();
  const password = String(b.password || '');
  const cashapp = String(b.cashapp || '').trim();
  const venmo = String(b.venmo || '').trim();
  const paypal = String(b.paypal || '').trim();
  const title = String(b.title || '').trim();
  const description = String(b.description || '').trim();
  const category = CATEGORIES.includes(b.category) ? b.category : 'other';
  const priceCents = priceToCents(b.price);

  const values = { email, display_name: displayName, cashapp, venmo, paypal, title, description, category, price: b.price };
  const fail = (error) => res.render('sell/start', { title: 'Start selling', values, categories: CATEGORIES, error });

  if (!displayName || !email || !password) return fail('Name, email, and password are required.');
  if (password.length < 6) return fail('Password must be at least 6 characters.');
  if (!cashapp && !venmo && !paypal) return fail('Add at least one payment handle (Cash App, Venmo, or PayPal) so you can get paid.');
  if (!title || !Number.isFinite(priceCents)) return fail('Your item needs a title and a valid price.');

  const exists = await db.get('SELECT id FROM users WHERE email = ?', email);
  if (exists) return fail('That email is already registered — log in instead, then add your listing.');

  // Create the seller account.
  const hash = bcrypt.hashSync(password, 10);
  const userInfo = await db.run(
    `INSERT INTO users (email, password_hash, display_name, role, cashapp, venmo, paypal)
     VALUES (?, ?, ?, 'seller', ?, ?, ?)`,
    email,
    hash,
    displayName,
    cashapp,
    venmo,
    paypal
  );
  const sellerId = Number(userInfo.lastInsertRowid);

  // Create the first listing.
  const prodInfo = await db.run(
    'INSERT INTO products (seller_id, title, description, price_cents, category) VALUES (?, ?, ?, ?, ?)',
    sellerId,
    title,
    description,
    priceCents,
    category
  );
  const productId = Number(prodInfo.lastInsertRowid);

  const images = (req.files && req.files.images) || [];
  let ipos = 0;
  for (const f of images) {
    const { url, public_id } = await uploadImage(f.buffer, f.originalname);
    await db.run(
      'INSERT INTO product_images (product_id, url, public_id, position) VALUES (?, ?, ?, ?)',
      productId,
      url,
      public_id,
      ipos++
    );
  }

  const deliverables = (req.files && req.files.deliverables) || [];
  let dpos = 0;
  for (const f of deliverables) {
    const d = await uploadDeliverable(f.buffer, f.originalname);
    await db.run(
      'INSERT INTO deliverables (product_id, storage, ref, resource_type, original_name, position) VALUES (?, ?, ?, ?, ?, ?)',
      productId,
      d.storage,
      d.ref,
      d.resource_type,
      d.original_name,
      dpos++
    );
  }

  // Log them in.
  req.session.userId = sellerId;
  req.session.ageConfirmed = true;
  req.session.flash = { type: 'success', msg: 'You’re live! Your listing is published and your shop is ready.' };
  res.redirect('/seller');
});

module.exports = router;
