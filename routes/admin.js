// Admin area: overview, users, listings, orders.
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware');
const { deleteImage, deleteDeliverable } = require('../storage');

const router = express.Router();

function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

router.use(requireRole('admin'));

// --- Overview ---------------------------------------------------------------
router.get('/', async (req, res) => {
  const stats = {
    users: (await db.get('SELECT COUNT(*) AS c FROM users')).c,
    sellers: (await db.get("SELECT COUNT(*) AS c FROM users WHERE role = 'seller'")).c,
    listings: (await db.get('SELECT COUNT(*) AS c FROM products')).c,
    orders: (await db.get('SELECT COUNT(*) AS c FROM orders')).c,
    revenue: (await db.get("SELECT COALESCE(SUM(amount_cents),0) AS s FROM orders WHERE status IN ('paid','shipped')")).s,
  };
  const recentOrders = await db.all(
    `SELECT o.*, p.title, COALESCE(b.display_name, o.contact, 'Guest') AS buyer_name, s.display_name AS seller_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       LEFT JOIN users b ON b.id = o.buyer_id
       JOIN users s ON s.id = o.seller_id
      ORDER BY o.created_at DESC LIMIT 10`
  );
  res.render('admin/overview', { title: 'Admin', stats, recentOrders });
});

// --- Users ------------------------------------------------------------------
router.get('/users', async (req, res) => {
  const users = await db.all(
    `SELECT u.*,
            (SELECT COUNT(*) FROM products WHERE seller_id = u.id) AS listing_count,
            (SELECT COUNT(*) FROM orders WHERE buyer_id = u.id) AS order_count
       FROM users u ORDER BY u.created_at DESC`
  );
  res.render('admin/users', { title: 'Users', users });
});

router.post('/users/:id/role', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  const role = ['buyer', 'seller', 'admin'].includes(req.body.role) ? req.body.role : null;
  if (!user || !role) return res.redirect('/admin/users');
  if (user.id === req.user.id) {
    flash(req, 'error', "You can't change your own role.");
    return res.redirect('/admin/users');
  }
  await db.run('UPDATE users SET role = ? WHERE id = ?', role, user.id);
  flash(req, 'success', user.display_name + ' is now ' + role + '.');
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) return res.redirect('/admin/users');
  if (user.id === req.user.id) {
    flash(req, 'error', "You can't delete your own account here.");
    return res.redirect('/admin/users');
  }
  const imgs = await db.all(
    'SELECT * FROM product_images WHERE product_id IN (SELECT id FROM products WHERE seller_id = ?)',
    user.id
  );
  const dels = await db.all(
    'SELECT * FROM deliverables WHERE product_id IN (SELECT id FROM products WHERE seller_id = ?)',
    user.id
  );
  await db.run('DELETE FROM users WHERE id = ?', user.id); // cascades to products/images/deliverables/orders
  for (const im of imgs) await deleteImage(im);
  for (const d of dels) await deleteDeliverable(d);
  flash(req, 'success', 'User deleted.');
  res.redirect('/admin/users');
});

// --- Listings ---------------------------------------------------------------
router.get('/listings', async (req, res) => {
  const listings = await db.all(
    `SELECT p.*, u.display_name AS seller_name,
            (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position, id LIMIT 1) AS thumb
       FROM products p JOIN users u ON u.id = p.seller_id
      ORDER BY p.created_at DESC`
  );
  res.render('admin/listings', { title: 'All listings', listings });
});

router.post('/listings/:id/status', async (req, res) => {
  const status = ['active', 'sold', 'hidden'].includes(req.body.status) ? req.body.status : null;
  if (status) await db.run('UPDATE products SET status = ? WHERE id = ?', status, req.params.id);
  res.redirect('/admin/listings');
});

router.post('/listings/:id/delete', async (req, res) => {
  const imgs = await db.all('SELECT * FROM product_images WHERE product_id = ?', req.params.id);
  const dels = await db.all('SELECT * FROM deliverables WHERE product_id = ?', req.params.id);
  await db.run('DELETE FROM products WHERE id = ?', req.params.id);
  for (const im of imgs) await deleteImage(im);
  for (const d of dels) await deleteDeliverable(d);
  flash(req, 'success', 'Listing deleted.');
  res.redirect('/admin/listings');
});

// --- Orders -----------------------------------------------------------------
router.get('/orders', async (req, res) => {
  const orders = await db.all(
    `SELECT o.*, p.title, COALESCE(b.display_name, o.contact, 'Guest') AS buyer_name, s.display_name AS seller_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       LEFT JOIN users b ON b.id = o.buyer_id
       JOIN users s ON s.id = o.seller_id
      ORDER BY o.created_at DESC`
  );
  res.render('admin/orders', { title: 'All orders', orders });
});

router.post('/orders/:id/status', async (req, res) => {
  const status = ['pending', 'paid', 'shipped', 'cancelled'].includes(req.body.status) ? req.body.status : null;
  if (status) await db.run('UPDATE orders SET status = ? WHERE id = ?', status, req.params.id);
  res.redirect('/admin/orders');
});

module.exports = router;
